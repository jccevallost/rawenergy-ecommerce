import { randomUUID } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { authService, type AuthUser } from "./auth.service.js";
import { mailService } from "./mail.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { telegramService } from "./telegram.service.js";

// CU12: solicitudes de cancelación y su resolución por el equipo (plan §8, §12 «Cancelación»).
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(mailService, "sendStatusUpdate").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

const server = new ApolloServer({ typeDefs, resolvers });
type Result = { data?: Record<string, any> | null; errors?: Array<{ message: string; extensions?: { code?: string } }> };
async function run(query: string, variables: Record<string, unknown>, user: AuthUser | null): Promise<Result> {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user: user as never, requestId: randomUUID(), ip: `198.51.100.${Math.floor(Math.random() * 250)}` } });
  if (response.body.kind !== "single") throw new Error("single");
  return response.body.singleResult as Result;
}
const REQUEST = "mutation($n:String!,$r:CancellationReason!){ requestOrderCancellation(number:$n, reason:$r){ status cancellation { canCancel canRequestCancellation reason } cancellationRequest { status reason publicNote } } }";
const ONE = "query($n:String!){ myOrder(number:$n){ status paidAt refund { at } events { note } cancellation { canRequestCancellation } cancellationRequest { status publicNote } } }";
const LIST = "query($s:String){ cancellationRequests(status:$s){ id orderNumber status revision reasonLabel order { status customerName } } }";
const RESOLVE = "mutation($id:ID!,$r:Int!,$a:Boolean!,$p:String!){ resolveCancellationRequest(id:$id, revision:$r, approve:$a, publicNote:$p){ status publicNote revision } }";
const staff = { id: "staff-cancel", name: "Bodega", email: "bodega@example.test", role: "WAREHOUSE", status: "ACTIVE", twoFactorEnabled: true } as AuthUser;
let serial = 980000;
const cedula = () => { const base = `17${String(++serial).padStart(7, "0")}`; const sum = base.split("").map(Number).reduce((s, v, i) => { let x = i % 2 === 0 ? v * 2 : v; if (x > 9) x -= 9; return s + x; }, 0); return base + ((10 - (sum % 10)) % 10); };
let item: { productId: string; variantSku: string };
const stock = async () => (await productService.get(item.productId) as { variants: Array<{ sku: string; stock: number }> }).variants.find(v => v.sku === item.variantSku)!.stock;
type Created = { id?: unknown; _id?: unknown; orderNumber: string };
const idOf = (created: Created) => String(created.id ?? created._id);
const customer = async () => (await authService.createVerifiedCustomer({ name: "Ana Pérez", email: `solicita-${randomUUID()}@example.test`, password: "Solicitud-segura-2026" })).user as AuthUser;
const buy = (user: AuthUser) => orderService.create({ idempotencyKey: randomUUID(), customer: { fullName: "Ana Pérez", email: user.email, phone: `09${String(++serial).padStart(8, "0")}`, province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: cedula() }, items: [{ ...item, quantity: 1 }], shippingMethod: "SERVIENTREGA_NATIONAL", paymentMethod: "BANK_TRANSFER" }, user) as Promise<Created>;
const pendingFor = async (orderNumber: string) => ((await run(LIST, { s: "PENDING" }, staff)).data!.cancellationRequests as Array<{ id: string; orderNumber: string; revision: number }>).filter(r => r.orderNumber === orderNumber);

beforeAll(async () => {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `solicitud-${randomUUID()}`;
  payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), stock: 500, price: 20 }];
  const { id } = await productService.upsert(undefined, payload) as { id: string };
  item = { productId: id, variantSku: payload.variants[0]!.sku };
});

describe("solicitud del cliente", () => {
  it("con pago por verificar se pide al equipo; repetirla o pedirla a la vez deja una sola", async () => {
    const user = await customer();
    const order = await buy(user);
    await orderService.updateStatus(idOf(order), "PAYMENT_REVIEW");
    const [a, b] = await Promise.all([run(REQUEST, { n: order.orderNumber, r: "CHANGED_MIND" }, user), run(REQUEST, { n: order.orderNumber, r: "OTHER" }, user)]);
    expect(a.errors ?? b.errors).toBeUndefined();
    expect(a.data!.requestOrderCancellation.cancellationRequest.status).toBe("PENDING");
    expect(a.data!.requestOrderCancellation.cancellation).toMatchObject({ canCancel: false, canRequestCancellation: false, reason: "Tu solicitud de cancelación está en revisión." });
    expect(await pendingFor(order.orderNumber)).toHaveLength(1);
  });

  it("quien dice que ya envió el comprobante puede pedirla aunque el sistema aún no lo vea; un pedido ajeno no existe; uno enviado no", async () => {
    const user = await customer(), other = await customer();
    const order = await buy(user);
    expect((await run(REQUEST, { n: order.orderNumber, r: "OTHER" }, other)).errors?.[0]?.message).toBe("No encontramos ese pedido en tu cuenta.");
    const asked = await run(REQUEST, { n: order.orderNumber, r: "OTHER" }, user);
    expect(asked.data!.requestOrderCancellation.cancellationRequest.status).toBe("PENDING");
    expect(asked.data!.requestOrderCancellation.cancellation.canCancel).toBe(false);
    const gone = await buy(user);
    for (const status of ["PAID", "PREPARING", "SHIPPED"]) await orderService.updateStatus(idOf(gone), status);
    expect((await run(REQUEST, { n: gone.orderNumber, r: "OTHER" }, user)).errors?.[0]?.extensions?.code).toBe("NOT_CANCELLABLE");
  });
});

describe("resolución del equipo", () => {
  it("aprobar con la revisión vigente cancela, libera stock y el cliente ve la decisión y el reembolso pendiente", async () => {
    const user = await customer();
    const order = await buy(user);
    await orderService.updateStatus(idOf(order), "PAID");
    await run(REQUEST, { n: order.orderNumber, r: "DELAY" }, user);
    const [request] = await pendingFor(order.orderNumber);
    const before = await stock();
    expect((await run(RESOLVE, { id: request!.id, r: request!.revision + 1, a: true, p: "" }, staff)).errors?.[0]?.extensions?.code).toBe("CONFLICT");
    const approved = await run(RESOLVE, { id: request!.id, r: request!.revision, a: true, p: "" }, staff);
    expect(approved.data!.resolveCancellationRequest.status).toBe("APPROVED");
    expect(await stock()).toBe(before + 1);
    expect((await run(RESOLVE, { id: request!.id, r: request!.revision, a: false, p: "Rechazo tardío" }, staff)).errors?.[0]?.extensions?.code).toBe("CONFLICT");
    const seen = (await run(ONE, { n: order.orderNumber }, user)).data!.myOrder;
    expect(seen).toMatchObject({ status: "CANCELLED", refund: null, cancellationRequest: { status: "APPROVED" } });
    expect(seen.paidAt).toBeTruthy();
    expect(seen.events.at(-1).note).toBe("Cancelado por nuestro equipo a tu pedido");
  });

  it("rechazar exige un motivo público que el cliente ve; luego puede volver a pedirla", async () => {
    const user = await customer();
    const order = await buy(user);
    await orderService.updateStatus(idOf(order), "PAYMENT_REVIEW");
    await run(REQUEST, { n: order.orderNumber, r: "OTHER" }, user);
    const [request] = await pendingFor(order.orderNumber);
    expect((await run(RESOLVE, { id: request!.id, r: request!.revision, a: false, p: "" }, staff)).errors?.[0]?.message).toMatch(/motivo del rechazo/);
    expect((await run(RESOLVE, { id: request!.id, r: request!.revision, a: false, p: "Tu pedido ya está en camino." }, staff)).data!.resolveCancellationRequest.status).toBe("REJECTED");
    const seen = (await run(ONE, { n: order.orderNumber }, user)).data!.myOrder;
    expect(seen).toMatchObject({ status: "PAYMENT_REVIEW", cancellationRequest: { status: "REJECTED", publicNote: "Tu pedido ya está en camino." }, cancellation: { canRequestCancellation: true } });
  });

  it("no aprueba un pedido que ya salió; una cancelación por otra vía cierra la solicitud", async () => {
    const user = await customer();
    const shipped = await buy(user), other = await buy(user);
    for (const order of [shipped, other]) { await orderService.updateStatus(idOf(order), "PAID"); await run(REQUEST, { n: order.orderNumber, r: "OTHER" }, user); }
    await orderService.updateStatus(idOf(shipped), "PREPARING"); await orderService.updateStatus(idOf(shipped), "SHIPPED");
    const [late] = await pendingFor(shipped.orderNumber);
    expect((await run(RESOLVE, { id: late!.id, r: late!.revision, a: true, p: "" }, staff)).errors?.[0]?.extensions?.code).toBe("NOT_CANCELLABLE");
    expect(await pendingFor(shipped.orderNumber)).toHaveLength(1);
    await orderService.updateStatus(idOf(other), "CANCELLED", { reason: "Cancelación antes del despacho" });
    expect(await pendingFor(other.orderNumber)).toHaveLength(0);
    expect((await run(ONE, { n: other.orderNumber }, user)).data!.myOrder.cancellationRequest.status).toBe("APPROVED");
  });

  it("solo el personal con orders.write ve y resuelve solicitudes", async () => {
    const user = await customer();
    expect((await run(LIST, {}, user)).errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    const manager = { ...staff, id: "manager", role: "MANAGER" } as AuthUser;
    expect((await run(LIST, {}, manager)).errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });
});
