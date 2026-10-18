// ROL-01: matriz del jefe de tienda probada con llamadas directas a la API, no solo con botones ocultos.
import { ApolloServer } from "@apollo/server";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { authService, type AuthUser } from "./auth.service.js";
import { permissions } from "./permissions.js";

const server = new ApolloServer({ typeDefs, resolvers });
const run = async (query: string, variables: Record<string, unknown> = {}, user: AuthUser | null = null) => {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user, requestId: randomUUID(), ip: "203.0.113.99" } });
  if (response.body.kind !== "single") throw new Error("Expected single result");
  return response.body.singleResult;
};
const today = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
let admin: AuthUser, manager: AuthUser;

beforeAll(async () => {
  authService.setPersistence(false); await authService.bootstrapAdmin(); admin = (await authService.users("ADMIN"))[0]!;
  await authService.saveAccount(admin, undefined, { name: "Jefa de tienda", email: "jefa-rol@example.test", password: "Clave-de-tienda-2026", role: "STORE_MANAGER", status: "ACTIVE" });
  manager = (await authService.me((await authService.login({ email: "jefa-rol@example.test", password: "Clave-de-tienda-2026" })).token))!;
});

describe("Rol de jefe de tienda (ROL-01)", () => {
  it("tiene los permisos decididos y ninguno de administración del sistema", () => {
    expect(permissions.STORE_MANAGER).toEqual(expect.arrayContaining(["catalog.write", "inventory.write", "orders.write", "purchases.write", "management.read", "audit.read", "expenses.write"]));
    expect(permissions.STORE_MANAGER).not.toContain("system.manage");
    expect(manager.role).toBe("STORE_MANAGER");
  });

  it("opera inventario, compras, pedidos, resultados, auditoría y catálogo", async () => {
    for (const query of ["{ supplyOverview }", "{ managementDashboard(filters: { year: 2026 }) }", "{ auditEvents }", "{ commercialOverview }", "{ stockMovements }", "{ orders(limit: 5) { totalCount } }"]) {
      const result = await run(query, {}, manager);
      expect(result.errors, query).toBeUndefined();
    }
    const supplier = await run("mutation { saveSupplier(input: { name: \"Proveedor del jefe\" }) }", {}, manager);
    expect(supplier.errors).toBeUndefined();
  });

  it("registra y corrige gastos, pero no los anula", async () => {
    const id = randomUUID();
    const saved = await run("mutation($id:ID!,$input:JSON!){ saveExpense(id:$id,input:$input) }", { id, input: { date: today, category: "TRANSPORT", amount: 12.5, description: "Envío de mercadería", reference: "" } }, manager);
    expect(saved.errors).toBeUndefined();
    const voided = await run("mutation($id:ID!){ voidExpense(id:$id,revision:0,reason:\"Prueba de permiso\") }", { id }, manager);
    expect(voided.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });

  it("no administra usuarios, seguridad, configuración global ni la base de datos", async () => {
    const denied = [
      "{ accounts }",
      "{ users { id } }",
      "{ storeSettings { persistence } }",
      "{ commerceSettings }",
      "{ notificationOutbox }",
      `mutation { saveAccount(input: { name: "Intruso", email: "intruso@example.test", password: "Clave-de-intruso-2026", role: "ADMIN", status: "ACTIVE" }) { id } }`,
      `mutation { updateUserRole(id: "${manager.id}", role: ADMIN) { id } }`,
      "mutation { mergeProducts(input: {}) }"
    ];
    for (const query of denied) {
      const result = await run(query, {}, manager);
      expect(result.errors?.[0]?.extensions?.code, query).toBe("FORBIDDEN");
    }
  });

  it("Administración puede crear la cuenta y verla con su rol", async () => {
    const list = await authService.users("STORE_MANAGER");
    expect(list.map(u => u.email)).toContain("jefa-rol@example.test");
  });
});
