import { randomUUID } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { expenseService } from "./expense.service.js";
import { authService, type AuthUser } from "./auth.service.js";
import { auditService } from "./audit.service.js";
import { computeManagement, financialSummary, type ManagementOrder } from "./management.service.js";
import { stockSummary } from "./commercial.service.js";

const server = new ApolloServer({ typeDefs, resolvers });
let admin: AuthUser;
const payload = { date: "2025-09-10", category: "ADVERTISING" as const, amount: 25.50, description: "Publicidad de campaña", reference: "FAC-001" };
const mutation = "mutation($id:ID!,$input:JSON!,$revision:Int){saveExpense(id:$id,input:$input,revision:$revision)}";
async function execute(query: string, variables: Record<string, unknown> = {}, user: AuthUser | null = admin) {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user, requestId: randomUUID() } });
  if (response.body.kind !== "single") throw new Error("Respuesta inesperada");
  return response.body.singleResult;
}
beforeAll(async () => { authService.setPersistence(false); await authService.bootstrapAdmin(); admin = (await authService.users("ADMIN"))[0]!; });

describe("Gastos y resultado comercial", () => {
  it("conserva el gasto al reintentar y rechaza reutilizar el intento con otros datos", async () => {
    const id = randomUUID();
    const first = await expenseService.save(id, payload, undefined, admin);
    expect(await expenseService.save(id, payload, undefined, admin)).toEqual(first);
    await expect(expenseService.save(id, { ...payload, amount: 99 }, undefined, admin)).rejects.toThrow(/intento/);
    expect((await expenseService.list({ year: 2025, month: 9, search: payload.reference })).rows.filter(e => e.id === id)).toHaveLength(1);
  });
  it("solo acepta una corrección concurrente y conserva el responsable original", async () => {
    const id = randomUUID(); await expenseService.save(id, payload, undefined, admin);
    const results = await Promise.allSettled([expenseService.save(id, { ...payload, amount: 30 }, 0, admin), expenseService.save(id, { ...payload, amount: 40 }, 0, admin)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await expenseService.get(id)).toMatchObject({ amount: 30, revision: 1, createdBy: admin.id });
  });
  it("anular excluye del resultado, conserva el registro y bloquea ediciones posteriores", async () => {
    const id = randomUUID(); await expenseService.save(id, { ...payload, reference: id }, undefined, admin);
    await expenseService.void(id, 0, "Factura registrada por duplicado", admin);
    expect((await expenseService.forPeriod("2025-09-01", "2025-10-01")).some(e => e.id === id)).toBe(false);
    expect(await expenseService.list({ year: 2025, status: "ALL", search: id })).toMatchObject({ total: 1, activeAmount: 0, voidAmount: 25.5 });
    await expect(expenseService.save(id, payload, 1, admin)).rejects.toThrow(/anulado/);
  });
  it("registra diferencias de gasto en auditoría y revierte un guardado sin auditoría", async () => {
    const id = randomUUID();
    expect((await execute(mutation, { id, input: payload })).errors).toBeUndefined();
    expect((await execute(mutation, { id, input: { ...payload, amount: 42 }, revision: 0 })).errors).toBeUndefined();
    const journal = await auditService.list({ entity: "expenses", search: id, status: "SUCCESS" });
    expect(journal.rows.some(r => (r.before as { amount?: number })?.amount === 25.5 && (r.after as { amount?: number })?.amount === 42)).toBe(true);
    const original = auditService.record.bind(auditService);
    const spy = vi.spyOn(auditService, "record").mockImplementation(async e => { if (e.entity === "expenses" && e.status === "SUCCESS") throw new Error("Auditoría no disponible"); return original(e); });
    try {
      const failedId = randomUUID();
      expect((await execute(mutation, { id: failedId, input: payload })).errors).toBeDefined();
      expect(await expenseService.get(failedId)).toBeNull();
    } finally { spy.mockRestore(); }
  });
  it("gerencia consulta gastos; solo administración puede registrar o anular", async () => {
    for (const role of ["MANAGER", "WAREHOUSE", "CATALOG"] as const) {
      const user = await authService.saveAccount(admin, undefined, { name: role, email: `expense-${role}@example.com`, password: "Expense-test-123!", role, status: "ACTIVE" });
      expect(Boolean((await execute("{expenses(filters:{year:2025}) commercialOverview}", {}, user)).errors)).toBe(role !== "MANAGER");
      expect((await execute(mutation, { id: randomUUID(), input: payload }, user)).errors).toBeDefined();
    }
    expect((await execute("{expenses(filters:{year:2025})}", {}, null)).errors).toBeDefined();
  });
  it("rechaza fechas inválidas y futuras, importes negativos y más de dos decimales", async () => {
    for (const patch of [{ date: "2025-02-30" }, { date: "2099-01-01" }, { amount: -3 }, { amount: 1.001 }]) await expect(expenseService.save(randomUUID(), { ...payload, ...patch }, undefined, admin)).rejects.toThrow();
  });
  it("calcula pérdidas operativas, cuenta el envío una vez y excluye gastos anulados", () => {
    const orders: ManagementOrder[] = [{ createdAt: "2025-09-10T15:00:00Z", status: "PAID", shippingFee: 5, items: [{ productId: "p", variantSku: "one", title: "Creatina", quantity: 2, lineTotal: 100, unitCost: 30 }, { productId: "p", variantSku: "two", title: "Creatina", quantity: 1, lineTotal: 50, unitCost: 40 }] }];
    const report = computeManagement([], orders, { year: 2025, month: 9 }, new Date("2025-10-01T05:00:00Z"));
    const expenses = [{ ...payload, status: "ACTIVE" as const, amount: 60 }, { ...payload, status: "VOID" as const, amount: 500 }, { ...payload, date: "2025-10-01", status: "ACTIVE" as const, amount: 900 }];
    expect(financialSummary(report, expenses)).toMatchObject({ shippingRevenue: 5, expenseTotal: 60, result: -5 });
    expect(report.ranking[0]).toMatchObject({ grossProfit: 50, cost: 100, costComplete: true });
    expect(report.months[8]).toMatchObject({ shippingRevenue: 5, grossProfit: 50 });
  });
  it("no presenta un resultado completo cuando faltan costos o se filtra una categoría", () => {
    const order: ManagementOrder = { createdAt: "2025-09-10T15:00:00Z", status: "PAID", items: [{ productId: "p", variantSku: "one", title: "Creatina", quantity: 2, lineTotal: 100, categories: [{ slug: "creatina", name: "Creatina" }] }] };
    const report = computeManagement([], [order], { year: 2025, month: 9 }, new Date("2025-10-01T05:00:00Z"));
    expect(financialSummary(report, [])).toMatchObject({ completeCosts: false, result: null });
    expect(report.months[8]?.grossProfit).toBeNull();
    order.items[0]!.unitCost = 0;
    const filtered = computeManagement([], [order], { year: 2025, month: 9, category: "creatina" }, new Date("2025-10-01T05:00:00Z"));
    expect(financialSummary(filtered, [])).toMatchObject({ completeCosts: true, categoryFiltered: true, result: null });
    expect(financialSummary(computeManagement([], [], { year: 2025, month: 9 }), [{ ...payload, status: "ACTIVE" }]).result).toBe(-25.5);
  });
  it("valora las existencias físicas sin inventar costos y respeta el día de Ecuador", () => {
    const base = { productId: "p", title: "Creatina", sku: "SKU", warehouseId: "main", lot: "L1", expiresOn: "2025-09-09", onHand: 3, reserved: 1, available: 2, unitCost: 10 };
    const summary = stockSummary([base, { ...base, lot: "L2", expiresOn: "2025-09-10", unitCost: null }, { ...base, lot: "L3", expiresOn: "2025-10-11", unitCost: 0 }], new Date("2025-09-10T05:00:00Z"));
    expect(summary).toMatchObject({ units: 9, knownValue: 30, unknownUnits: 3, reserved: 3, expired: { units: 3 }, expiring: { units: 3, unknownUnits: 3 } });
    expect(summary.riskLots).toBe(2);
  });
});
