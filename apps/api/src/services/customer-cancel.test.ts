import { randomUUID } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { authService, type AuthUser } from "./auth.service.js";
import { mailService } from "./mail.service.js";
import { notificationOutbox } from "./outbox.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { telegramService } from "./telegram.service.js";

// CU11: cancelación directa del cliente y bloqueo tras 3 seguidas (decisiones del propietario del 16/10/2026).
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(mailService, "sendStatusUpdate").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);
const enqueue = vi.spyOn(notificationOutbox, "enqueue");

const server = new ApolloServer({ typeDefs, resolvers });
type Result = { data?: Record<string, any> | null; errors?: Array<{ message: string; extensions?: { code?: string } }> };
async function run(query: string, variables: Record<string, unknown>, user: AuthUser | null): Promise<Result> {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user: user as never, requestId: randomUUID(), ip: `198.51.100.${Math.floor(Math.random() * 250)}` } });
  if (response.body.kind !== "single") throw new Error("single");
  return response.body.singleResult as Result;
}
const CANCEL = "mutation($n:String!){ cancelMyOrder(number:$n){ alreadyCancelled accountBlocked order { status events { note } cancellation { canCancel } } } }";
const ONE = "query($n:String!){ myOrder(number:$n){ cancellation { canCancel canRequestCancellation reason blocksAccount } } }";
const TRACK = "query($n:String!,$c:String!){ trackOrder(orderNumber:$n, contact:$c){ status } }";
let serial = 900000;
const cedula = () => { const base = `17${String(++serial).padStart(7, "0")}`; const sum = base.split("").map(Number).reduce((s, v, i) => { let x = i % 2 === 0 ? v * 2 : v; if (x > 9) x -= 9; return s + x; }, 0); return base + ((10 - (sum % 10)) % 10); };
let item: { productId: string; variantSku: string };
let admin: AuthUser;
const stock = async () => (await productService.get(item.productId) as { variants: Array<{ sku: string; stock: number }> }).variants.find(v => v.sku === item.variantSku)!.stock;
type Created = { id?: unknown; _id?: unknown; orderNumber: string };
const idOf = (created: Created) => String(created.id ?? created._id);
const PASSWORD = "Cancelar-seguro-2026";

async function shopper() {
  const created = await authService.createVerifiedCustomer({ name: "Ana Pérez", email: `cancela-${randomUUID()}@example.test`, password: PASSWORD });
  const identity = { fullName: "Ana Pérez", email: created.user.email, phone: `09${String(++serial).padStart(8, "0")}`, province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: cedula() };
  return { user: created.user as AuthUser, token: created.token, identity };
}
const buy = (who: { user: AuthUser | null; identity: Record<string, string> }, extra: Record<string, unknown> = {}) =>
  orderService.create({ idempotencyKey: randomUUID(), customer: who.identity, items: [{ ...item, quantity: 1 }], shippingMethod: "SERVIENTREGA_NATIONAL", paymentMethod: "BANK_TRANSFER", ...extra }, who.user) as Promise<Created>;

beforeAll(async () => {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `cancelar-${randomUUID()}`;
  payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), stock: 500, price: 20 }];
  const { id } = await productService.upsert(undefined, payload) as { id: string };
  item = { productId: id, variantSku: payload.variants[0]!.sku };
  await authService.bootstrapAdmin();
  admin = (await authService.users("ADMIN"))[0]!;
});

describe("cancelación directa", () => {
  it("cancela un pedido sin confirmar ni comprobante, devuelve el stock y deja un resultado estable", async () => {
    const who = await shopper();
    const before = await stock();
    const order = await buy(who);
    expect(await stock()).toBe(before - 1);
    const done = await run(CANCEL, { n: order.orderNumber }, who.user);
    expect(done.errors).toBeUndefined();
    expect(done.data!.cancelMyOrder).toMatchObject({ alreadyCancelled: false, accountBlocked: false, order: { status: "CANCELLED", cancellation: { canCancel: false } } });
    expect(done.data!.cancelMyOrder.order.events.at(-1).note).toBe("Cancelaste el pedido");
    expect(await stock()).toBe(before);
    const again = await run(CANCEL, { n: order.orderNumber }, who.user);
    expect(again.data!.cancelMyOrder.alreadyCancelled).toBe(true);
    expect(await stock()).toBe(before);
  });

  it("con comprobante, pago por verificar o pedido confirmado solo cancela el operador", async () => {
    const who = await shopper();
    const withReference = await buy(who, { paymentReference: "COMP-123" });
    const review = await buy(who);
    await orderService.updateStatus(idOf(review), "PAYMENT_REVIEW");
    for (const order of [withReference, review]) {
      const refused = await run(CANCEL, { n: order.orderNumber }, who.user);
      expect(refused.errors?.[0]?.extensions?.code).toBe("NOT_CANCELLABLE");
      expect((await run(ONE, { n: order.orderNumber }, who.user)).data!.myOrder.cancellation).toMatchObject({ canCancel: false, canRequestCancellation: true });
    }
  });

  it("un pedido ajeno responde igual que uno inexistente y no se toca", async () => {
    const owner = await shopper(), other = await shopper();
    const order = await buy(owner);
    const foreign = await run(CANCEL, { n: order.orderNumber }, other.user);
    const missing = await run(CANCEL, { n: "RE-000000-ZZZZZ" }, other.user);
    expect(foreign.errors?.[0]?.message).toBe(missing.errors?.[0]?.message);
    expect((await orderService.findByNumber(order.orderNumber) as { status: string }).status).toBe("PENDING_PAYMENT");
  });
});

describe("bloqueo tras 3 cancelaciones seguidas", () => {
  it("avisa antes de la tercera, bloquea al cliente en todas partes y el operador lo desbloquea", async () => {
    const who = await shopper();
    const stranger = { user: null, identity: { ...(await shopper()).identity } };
    const orders = [await buy(who), await buy(who), await buy(who)];
    const paidLater = await buy(who);
    enqueue.mockClear();
    await run(CANCEL, { n: orders[0]!.orderNumber }, who.user);
    await run(CANCEL, { n: orders[1]!.orderNumber }, who.user);
    expect((await run(ONE, { n: orders[2]!.orderNumber }, who.user)).data!.myOrder.cancellation.blocksAccount).toBe(true);
    const third = await run(CANCEL, { n: orders[2]!.orderNumber }, who.user);
    expect(third.data!.cancelMyOrder).toMatchObject({ accountBlocked: true, order: { status: "CANCELLED" } });
    expect(enqueue.mock.calls.some(([jobs]) => (jobs as Array<{ kind: string }>).some(job => job.kind === "OPERATOR_NOTICE"))).toBe(true);
    // Sesión revocada; con la contraseña correcta, mensaje neutral; con otra, el error de siempre.
    expect(await authService.me(who.token)).toBeNull();
    await expect(authService.login({ email: who.user.email, password: PASSWORD })).rejects.toMatchObject({ extensions: { code: "ACCOUNT_BLOCKED" } });
    await expect(authService.login({ email: who.user.email, password: "Otra-clave-2026" })).rejects.toMatchObject({ extensions: { code: "UNAUTHENTICATED" } });
    // Como invitado con su celular, y la consulta pública de sus pedidos, quedan rechazadas; otra persona sigue comprando.
    await expect(buy({ user: null, identity: { ...stranger.identity, phone: who.identity.phone } })).rejects.toMatchObject({ extensions: { code: "ACCOUNT_BLOCKED" } });
    expect((await run(TRACK, { n: paidLater.orderNumber, c: who.identity.email }, null)).errors?.[0]?.extensions?.code).toBe("ACCOUNT_BLOCKED");
    await expect(buy(stranger)).resolves.toBeTruthy();
    // Desbloqueo manual: vuelve a entrar y a comprar; el contador empieza de cero.
    await authService.setUserStatus(admin, who.user.id, "ACTIVE");
    const back = await authService.login({ email: who.user.email, password: PASSWORD });
    await expect(buy({ user: back.user as AuthUser, identity: who.identity })).resolves.toBeTruthy();
    expect(await authService.customerCancellations(who.user.id)).toBe(0);
  });

  it("desbloquear desde «Usuarios y permisos» (saveAccount) también levanta el bloqueo por identidad", async () => {
    const who = await shopper();
    for (let i = 0; i < 3; i++) await run(CANCEL, { n: (await buy(who)).orderNumber }, who.user);
    await expect(buy({ user: null, identity: who.identity })).rejects.toMatchObject({ extensions: { code: "ACCOUNT_BLOCKED" } });
    await authService.saveAccount(admin, who.user.id, { name: "Ana Pérez", email: who.user.email, role: "CUSTOMER", status: "ACTIVE" });
    await expect(buy({ user: null, identity: who.identity })).resolves.toBeTruthy();
    expect(await authService.customerCancellations(who.user.id)).toBe(0);
  });

  it("un pedido pagado o completado reinicia el contador", async () => {
    const who = await shopper();
    const a = await buy(who), b = await buy(who), paid = await buy(who), c = await buy(who);
    await run(CANCEL, { n: a.orderNumber }, who.user);
    await run(CANCEL, { n: b.orderNumber }, who.user);
    expect(await authService.customerCancellations(who.user.id)).toBe(2);
    await orderService.updateStatus(idOf(paid), "PAID");
    expect(await authService.customerCancellations(who.user.id)).toBe(0);
    const next = await run(CANCEL, { n: c.orderNumber }, who.user);
    expect(next.data!.cancelMyOrder.accountBlocked).toBe(false);
  });
});
