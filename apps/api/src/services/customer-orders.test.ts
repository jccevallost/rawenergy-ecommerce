import { randomUUID } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { authService, type AuthUser } from "./auth.service.js";
import { customerCancellation, publicEvents } from "./customerOrders.js";
import { mailService } from "./mail.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { telegramService } from "./telegram.service.js";

// CU09: «Mis pedidos» del cliente (plan §7.1, §8 y §12 «Propiedad» e «Historial»).
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(mailService, "sendStatusUpdate").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

const server = new ApolloServer({ typeDefs, resolvers });
type Result = { data?: Record<string, any> | null; errors?: Array<{ message: string; extensions?: { code?: string } }> };
async function run(query: string, variables: Record<string, unknown>, user: AuthUser | null): Promise<Result> {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user: user as never, requestId: randomUUID(), ip: "198.51.100.40" } });
  if (response.body.kind !== "single") throw new Error("single");
  return response.body.singleResult as Result;
}
const PAGE = "query($f:Int,$a:String,$x:CustomerOrderFilter){ myOrdersPage(first:$f, after:$a, filter:$x){ hasMore nextCursor orders { orderNumber status } } }";
const ONE = "query($n:String!){ myOrder(number:$n){ orderNumber status items { title quantity returnedQuantity } events { status at note } cancellation { canCancel canRequestCancellation reason } recipient { sameAsBuyer } delivery { city } } }";
let serial = 500000;
const cedula = () => { const base = `17${String(++serial).padStart(7, "0")}`; const sum = base.split("").map(Number).reduce((s, v, i) => { let x = i % 2 === 0 ? v * 2 : v; if (x > 9) x -= 9; return s + x; }, 0); return base + ((10 - (sum % 10)) % 10); };
let item: { productId: string; variantSku: string };
const customer = async () => (await authService.createVerifiedCustomer({ name: "Ana Pérez", email: `pedidos-${randomUUID()}@example.test`, password: "Pedidos-seguros-2026" })).user as AuthUser;
const order = async (user: AuthUser) => orderService.create({ idempotencyKey: randomUUID(), customer: { fullName: "Ana Pérez", email: user.email, phone: `09${String(++serial).padStart(8, "0")}`, province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: cedula() }, items: [{ ...item, quantity: 1 }], shippingMethod: "SERVIENTREGA_NATIONAL", paymentMethod: "BANK_TRANSFER" }, user) as Promise<{ id?: unknown; _id?: unknown; orderNumber: string }>;
const idOf = (created: { id?: unknown; _id?: unknown }) => String(created.id ?? created._id);
const memoryOrders = () => (orderService as unknown as { memory: Array<{ orderNumber: string; createdAt: Date }> }).memory;

beforeAll(async () => {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `pedidos-${randomUUID()}`;
  payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), stock: 500, price: 20 }];
  const { id } = await productService.upsert(undefined, payload) as { id: string };
  item = { productId: id, variantSku: payload.variants[0]!.sku };
});

describe("paginación y filtros", () => {
  it("recorre todas las páginas sin omitir ni repetir, aunque varios pedidos tengan la misma fecha", async () => {
    const user = await customer();
    const created = [];
    for (let i = 0; i < 7; i++) created.push((await order(user)).orderNumber);
    const same = new Date("2026-10-01T12:00:00.000Z");
    for (const number of created.slice(1, 5)) memoryOrders().find(o => o.orderNumber === number)!.createdAt = same;
    const seen: string[] = [];
    let after: string | null = null, pages = 0;
    do {
      const { data, errors } = await run(PAGE, { f: 3, a: after }, user);
      expect(errors).toBeUndefined();
      seen.push(...data!.myOrdersPage.orders.map((o: { orderNumber: string }) => o.orderNumber));
      after = data!.myOrdersPage.hasMore ? data!.myOrdersPage.nextCursor : null;
      pages++;
    } while (after && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual([...created].sort());
  });

  it("filtra activos, finalizados y cancelados; un cursor alterado se rechaza", async () => {
    const user = await customer();
    const active = await order(user), cancelled = await order(user);
    await orderService.updateStatus(idOf(cancelled), "CANCELLED", { reason: "Nota interna del operador" });
    const list = async (x: string) => (await run(PAGE, { x }, user)).data!.myOrdersPage.orders.map((o: { orderNumber: string }) => o.orderNumber);
    expect(await list("ACTIVE")).toEqual([active.orderNumber]);
    expect(await list("CANCELLED")).toEqual([cancelled.orderNumber]);
    expect(await list("FINISHED")).toEqual([]);
    expect((await run(PAGE, { a: "no-es-un-cursor" }, user)).errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
  });
});

describe("propiedad y proyección", () => {
  it("un pedido ajeno responde igual que uno inexistente y no aparece en la lista", async () => {
    const a = await customer(), b = await customer();
    const mine = await order(a);
    expect((await run(ONE, { n: mine.orderNumber }, b)).data!.myOrder).toBeNull();
    expect((await run(ONE, { n: "RE-000000-ZZZZZ" }, b)).data!.myOrder).toBeNull();
    expect((await run(PAGE, {}, b)).data!.myOrdersPage.orders).toEqual([]);
    expect((await run(ONE, { n: mine.orderNumber.toLowerCase() }, a)).data!.myOrder.orderNumber).toBe(mine.orderNumber);
  });

  it("no expone costos, lotes, actores ni notas internas", async () => {
    const user = await customer();
    const created = await order(user);
    await orderService.updateStatus(idOf(created), "CANCELLED", { reason: "Nota interna secreta del operador" });
    const full = await run(`query($n:String!){ myOrder(number:$n){ ${"orderNumber status events { status at note } items { title quantity unitPrice lineTotal } invoice { name } recipient { name } delivery { address }"} } }`, { n: created.orderNumber }, user);
    const text = JSON.stringify(full);
    for (const secret of ["Nota interna secreta", "allocations", "unitCost", "actorId", "admin"]) expect(text).not.toContain(secret);
    expect(full.data!.myOrder.events.map((e: { status: string; note: string | null }) => [e.status, e.note])).toEqual([["PENDING_PAYMENT", "Pedido registrado"], ["CANCELLED", null]]);
  });

  it("solo cuentas de cliente con sesión", async () => {
    expect((await run(PAGE, {}, null)).errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    const staff = { id: "staff", name: "Personal", email: "staff@example.test", role: "ADMIN", status: "ACTIVE", twoFactorEnabled: true } as AuthUser;
    expect((await run(PAGE, {}, staff)).errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });
});

describe("código de bienvenida (CUENTA-BIENVENIDA-01)", () => {
  it("se ofrece a una cuenta nueva, no tras su primera compra y otra vez si la cancela", async () => {
    const user = await customer();
    const first = async () => (await run("{ myProfile { firstPurchase } }", {}, user)).data!.myProfile.firstPurchase;
    expect(await first()).toBe(true);
    const created = await order(user);
    expect(await first()).toBe(false);
    await orderService.updateStatus(idOf(created), "CANCELLED", { reason: "Prueba" });
    expect(await first()).toBe(true);
  });
});

describe("historial público y capacidades", () => {
  it("solo muestra notas de la lista permitida", () => {
    const events = publicEvents([
      { from: "", to: "PENDING_PAYMENT", at: new Date("2026-10-01T10:00:00Z"), reason: "Pedido creado" },
      { from: "PENDING_PAYMENT", to: "PENDING_PAYMENT", at: new Date("2026-10-01T10:05:00Z"), reason: "Confirmado por WhatsApp" },
      { from: "PENDING_PAYMENT", to: "PENDING_PAYMENT", at: new Date("2026-10-01T10:06:00Z"), reason: "Nota interna" },
      { from: "PENDING_PAYMENT", to: "CANCELLED", at: new Date("2026-10-02T10:00:00Z"), reason: "Vencido: sin pago en 24 horas" }
    ]);
    expect(events.map(e => e.note)).toEqual(["Pedido registrado", "Pedido confirmado", "Cancelado automáticamente: no recibimos el pago a tiempo"]);
  });

  it("aplica la política del propietario: cancela el cliente sin confirmación ni comprobante; si no, el operador", () => {
    expect(customerCancellation({ status: "PENDING_PAYMENT" })).toMatchObject({ canCancel: true, canRequestCancellation: false });
    expect(customerCancellation({ status: "PENDING_PAYMENT", paymentReference: "123" })).toMatchObject({ canCancel: false, canRequestCancellation: true });
    expect(customerCancellation({ status: "PENDING_PAYMENT", confirmedAt: new Date() })).toMatchObject({ canCancel: false, canRequestCancellation: true });
    for (const status of ["PAYMENT_REVIEW", "PAID", "PREPARING"]) expect(customerCancellation({ status })).toMatchObject({ canCancel: false, canRequestCancellation: true });
    for (const status of ["SHIPPED", "COMPLETED", "CANCELLED", "RETURNED"]) expect(customerCancellation({ status })).toMatchObject({ canCancel: false, canRequestCancellation: false });
  });
});
