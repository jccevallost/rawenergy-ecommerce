import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { ApolloServer } from "@apollo/server";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { checkoutInputSchema, MAX_CHECKOUT_LINES } from "../validation/order.js";
import { authService, type AuthUser } from "./auth.service.js";
import { productService } from "./product.service.js";
import { orderService } from "./order.service.js";
import { mailService } from "./mail.service.js";
import { telegramService } from "./telegram.service.js";
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);
const customer = { fullName: "Persona de prueba", email: "test@example.test", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: "1700000001" };
async function fixture(stock = 2) {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `hostile-${randomUUID()}`;
  payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), stock, price: 25 }];
  const { id } = await productService.upsert(undefined, payload) as { id: string };
  const input = { idempotencyKey: randomUUID(), customer, items: [{ productId: id, variantSku: payload.variants[0]!.sku, quantity: 1 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER", expectedTotal: 29 };
  return { id, input, stock: async () => (await productService.get(id))!.variants[0]!.stock };
}
describe("Checkout adversarial en memoria", () => {
  it("20 solicitudes distintas compiten por una unidad: una sola compra y ningún saldo negativo", async () => {
    const f = await fixture(1);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => orderService.create({ ...f.input, idempotencyKey: randomUUID() })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1); expect(await f.stock()).toBe(0);
  });
  it("20 reintentos simultáneos crean una orden y una notificación incluso agotando el stock", async () => {
    const f = await fixture(1); const before = vi.mocked(mailService.sendOrderConfirmation).mock.calls.length;
    const orders = await Promise.all(Array.from({ length: 20 }, () => orderService.create(f.input)));
    expect(new Set(orders.map(order => String(order.id))).size).toBe(1); expect(await f.stock()).toBe(0);
    expect(vi.mocked(mailService.sendOrderConfirmation).mock.calls.length - before).toBe(1);
    expect((await orderService.create(f.input)).id).toBe(orders[0]!.id);
  });
  it("revierte la primera reserva si una segunda línea falla por lote vencido", async () => {
    const a = await fixture(), b = await fixture();
    const second = (await productService.get(b.id))!.variants[0]! as unknown as { lots: Array<{ expiresOn: string }> };
    second.lots.forEach(lot => { lot.expiresOn = "2000-01-01"; });
    const before = vi.mocked(mailService.sendOrderConfirmation).mock.calls.length;
    await expect(orderService.create({ ...a.input, expectedTotal: 54, items: [...a.input.items, ...b.input.items] })).rejects.toThrow(/vencido/);
    expect(await a.stock()).toBe(2); expect(await b.stock()).toBe(2);
    expect(vi.mocked(mailService.sendOrderConfirmation).mock.calls.length).toBe(before);
  });
  it("rechaza un precio distinto del aceptado sin reservar ni crear pedido", async () => {
    const f = await fixture();
    await expect(orderService.create({ ...f.input, expectedTotal: 28 })).rejects.toMatchObject({ extensions: { code: "CART_TOTAL_CHANGED" } });
    expect(await f.stock()).toBe(2);
    expect((await orderService.create(f.input)).total).toBe(29);
  });
  it("rechaza provincias incompatibles con express, espacios y líneas duplicadas", async () => {
    const f = await fixture();
    await expect(orderService.create({ ...f.input, customer: { ...customer, province: "Guayas", city: "Guayaquil" } })).rejects.toThrow(/nacional/);
    for (const field of ["fullName", "address", "city", "province"]) expect(checkoutInputSchema.safeParse({ ...f.input, customer: { ...customer, [field]: "          " } }).success).toBe(false);
    expect(checkoutInputSchema.safeParse({ ...f.input, items: [...f.input.items, ...f.input.items] }).success).toBe(false);
    expect(await f.stock()).toBe(2);
  });
  it.each([0, -1, 1.5, NaN, Infinity, 100])("rechaza cantidad %s sin reservar", async quantity => {
    const f = await fixture();
    await expect(orderService.create({ ...f.input, items: [{ ...f.input.items[0], quantity }] })).rejects.toThrow(); expect(await f.stock()).toBe(2);
  });
  it("doble cancelación no duplica devolución de stock", async () => {
    const f = await fixture(); const order = await orderService.create(f.input);
    await Promise.all([orderService.updateStatus(String(order.id), "CANCELLED"), orderService.updateStatus(String(order.id), "CANCELLED")]);
    expect(await f.stock()).toBe(2);
  });
});

describe("Contrato del pedido por GraphQL (D12)", () => {
  const server = new ApolloServer({ typeDefs, resolvers });
  const run = async (query: string, variables: Record<string, unknown>, user: AuthUser | null, ip: string) => {
    const response = await server.executeOperation({ query, variables }, { contextValue: { user, requestId: randomUUID(), ip } });
    if (response.body.kind !== "single") throw new Error("Expected single result");
    return response.body.singleResult;
  };
  const ORDER = "mutation($i:CheckoutInput!){ createCheckoutOrder(input:$i){ orderNumber total } }";

  it("clientes e invitados confirman el total; sin él no se reserva ni se crea el pedido", async () => {
    const f = await fixture();
    const { expectedTotal: _omitted, ...withoutTotal } = f.input;
    const anonymous = await run(ORDER, { i: withoutTotal }, null, "203.0.113.120");
    expect(anonymous.errors?.[0]).toMatchObject({ message: expect.stringMatching(/Actualiza el total/), extensions: { code: "BAD_USER_INPUT" } });
    const account = await authService.createVerifiedCustomer({ name: "Cliente D12", email: "cliente-d12@example.test", password: "Pedido-seguro-4719" });
    const customerUser = (await authService.me(account.token))!;
    expect((await run(ORDER, { i: { ...withoutTotal, idempotencyKey: randomUUID() } }, customerUser, "203.0.113.121")).errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
    expect(await f.stock()).toBe(2);
    const created = await run(ORDER, { i: f.input }, null, "203.0.113.122");
    expect(created.errors).toBeUndefined();
    expect((created.data!.createCheckoutOrder as { total: number }).total).toBe(29);
    expect(await f.stock()).toBe(1);
  });

  it("el total del carrito y el pedido aceptan el mismo número de líneas", async () => {
    const lines = (count: number) => Array.from({ length: count }, (_, i) => ({ productId: "demo-2", variantSku: `SKU-${i}`, quantity: 1 }));
    expect(MAX_CHECKOUT_LINES).toBe(60);
    const TOTALS = "query($items:[CartItemInput!]!){ calculateCartTotals(cartItems:$items){ total } }";
    expect((await run(TOTALS, { items: lines(61) }, null, "203.0.113.123")).errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
    expect(checkoutInputSchema.safeParse({ ...(await fixture()).input, items: lines(61) }).success).toBe(false);
  });
});
