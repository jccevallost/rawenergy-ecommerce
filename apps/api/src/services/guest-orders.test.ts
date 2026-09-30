import { randomUUID } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { mailService } from "./mail.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { telegramService } from "./telegram.service.js";
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

const server = new ApolloServer({ typeDefs, resolvers });
const LINK = "mutation($n:[String!]!){ linkGuestOrders(orderNumbers:$n){ linked orderNumbers } }";
const MINE = "query{ myOrders { orderNumber } }";
const customer = { fullName: "Persona de prueba", email: "invitada@example.test", phone: "0991234567", province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: "1700000001" };
const account = (email: string, role = "CUSTOMER") => ({ id: `u-${randomUUID()}`, name: "Cuenta", email, role, status: "ACTIVE" as const });
let item: { productId: string; variantSku: string };

async function run(query: string, variables: Record<string, unknown>, user: unknown) {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user: user as never, requestId: randomUUID(), ip: `198.51.100.${Math.floor(Math.random() * 250)}` } });
  if (response.body.kind !== "single") throw new Error("single");
  return response.body.singleResult as { data?: Record<string, any>; errors?: Array<{ message: string; extensions?: { code?: string } }> };
}
const guestOrder = async (email = customer.email) => (await orderService.create({ idempotencyKey: randomUUID(), customer: { ...customer, email }, items: [{ ...item, quantity: 1 }], shippingMethod: "SERVIENTREGA_NATIONAL", paymentMethod: "BANK_TRANSFER" }) as { orderNumber: string }).orderNumber;

beforeAll(async () => {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `invitado-${randomUUID()}`;
  payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), stock: 50, price: 20 }];
  const { id } = await productService.upsert(undefined, payload) as { id: string };
  item = { productId: id, variantSku: payload.variants[0]!.sku };
});

describe("Pedidos de invitado en «Mis pedidos» (C44)", () => {
  it("enlaza un pedido con su número cuando el correo es el de la cuenta, y aparece en myOrders", async () => {
    const number = await guestOrder();
    const user = account("Invitada@Example.test");
    const result = await run(LINK, { n: [number.toLowerCase()] }, user);
    expect(result.errors).toBeUndefined();
    expect(result.data?.linkGuestOrders).toEqual({ linked: 1, orderNumbers: [number] });
    const mine = await run(MINE, {}, user);
    expect(mine.data?.myOrders.map((o: { orderNumber: string }) => o.orderNumber)).toContain(number);
    const stored = await orderService.findByNumber(number) as { history?: Array<{ reason: string }> };
    expect(stored.history?.at(-1)?.reason).toBe("Vinculado a la cuenta del cliente");
  });

  it("no enlaza el pedido de otro correo aunque se conozca el número", async () => {
    const number = await guestOrder("otra.persona@example.test");
    const result = await run(LINK, { n: [number] }, account("invitada@example.test"));
    expect(result.data?.linkGuestOrders).toEqual({ linked: 0, orderNumbers: [] });
  });

  it("un pedido ya enlazado no cambia de dueño, ni siquiera con el mismo correo", async () => {
    const number = await guestOrder();
    const first = account(customer.email), second = account(customer.email);
    expect((await run(LINK, { n: [number] }, first)).data?.linkGuestOrders.linked).toBe(1);
    expect((await run(LINK, { n: [number] }, second)).data?.linkGuestOrders.linked).toBe(0);
    expect((await run(MINE, {}, second)).data?.myOrders.map((o: { orderNumber: string }) => o.orderNumber)).not.toContain(number);
  });

  it("enlaza varios a la vez e ignora repetidos y los que no existen", async () => {
    const a = await guestOrder(), b = await guestOrder();
    const result = await run(LINK, { n: [a, b, a, "RE-990101-ZZZZZ"] }, account(customer.email));
    expect(result.data?.linkGuestOrders.linked).toBe(2);
    expect(result.data?.linkGuestOrders.orderNumbers).toEqual(expect.arrayContaining([a, b]));
  });

  it("rechaza números con formato inválido, listas vacías y más de 20 números", async () => {
    for (const n of [["123"], [], Array.from({ length: 21 }, (_, i) => `RE-260101-A${String(i).padStart(3, "0")}`)]) {
      const result = await run(LINK, { n }, account(customer.email));
      expect(result.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
    }
  });

  it("exige sesión de cliente: ni invitados ni personal del panel", async () => {
    const number = await guestOrder();
    expect((await run(LINK, { n: [number] }, null)).errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    expect((await run(LINK, { n: [number] }, account(customer.email, "ADMIN"))).errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });
});
