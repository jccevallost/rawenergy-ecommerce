// CLI-01: cuentas de clientes retiradas por decisión del propietario (14/10/2026). Se compra y se
// consulta el pedido sin cuenta; las cuentas existentes se conservan, pero no inician sesión.
import { ApolloServer } from "@apollo/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { authService, type AuthUser } from "./auth.service.js";
import { orderService } from "./order.service.js";
import { mailService } from "./mail.service.js";
import { telegramService } from "./telegram.service.js";
import { demoProducts } from "../data/demoProducts.js";
import { productService } from "./product.service.js";
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

const server = new ApolloServer({ typeDefs, resolvers });
const run = async (query: string, variables: Record<string, unknown> = {}, user: AuthUser | null = null) => {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user, requestId: crypto.randomUUID(), ip: "203.0.113.90" } });
  if (response.body.kind !== "single") throw new Error("Expected single result");
  return response.body.singleResult;
};
const REGISTER = "mutation($i:RegisterInput!){ register(input:$i){ accepted } }";
const LOGIN = "mutation($i:LoginInput!){ login(input:$i){ token user { role } } }";
let customerToken = "", admin: AuthUser;

beforeAll(async () => {
  authService.setPersistence(false); await authService.bootstrapAdmin(); admin = (await authService.users("ADMIN"))[0]!;
  // Cuenta creada mientras las cuentas existían.
  env.CUSTOMER_ACCOUNTS = "on";
  customerToken = (await authService.createVerifiedCustomer({ name: "Cliente antiguo", email: "antiguo@example.test", password: "Marea-Verde-2026x" })).token;
  env.CUSTOMER_ACCOUNTS = "off";
});
afterAll(() => { env.CUSTOMER_ACCOUNTS = "on"; });

describe("Cuentas de clientes retiradas (CLI-01)", () => {
  it("no crea cuentas y responde igual exista o no el correo", async () => {
    const fresh = await run(REGISTER, { i: { name: "Persona nueva", email: "nueva@example.test", password: "Persona-nueva-2026" } });
    const existing = await run(REGISTER, { i: { name: "Cliente antiguo", email: "antiguo@example.test", password: "Persona-nueva-2026" } });
    expect(fresh.errors?.[0]?.message).toMatch(/ya no usa cuentas de cliente/);
    expect(existing.errors?.[0]?.message).toBe(fresh.errors?.[0]?.message);
    expect(existing.errors?.[0]?.extensions?.code).toBe(fresh.errors?.[0]?.extensions?.code);
  });

  it("una cuenta de cliente existente no inicia sesión y su sesión anterior deja de valer", async () => {
    const wrong = await run(LOGIN, { i: { email: "antiguo@example.test", password: "Clave-equivocada-1" } });
    expect(wrong.errors?.[0]?.message).toBe("Correo o contraseña incorrectos");
    const right = await run(LOGIN, { i: { email: "antiguo@example.test", password: "Marea-Verde-2026x" } });
    expect(right.errors?.[0]?.message).toMatch(/Consulta tu pedido/);
    expect(await authService.me(customerToken)).toBeNull();
    expect((await authService.users("CUSTOMER")).some(u => u.email === "antiguo@example.test")).toBe(true);
  });

  it("el personal sigue entrando y la tienda sabe que no hay cuentas", async () => {
    await authService.saveAccount(admin, undefined, { name: "Bodega sin cuentas", email: "almacen-cli@example.test", password: "Clave-de-bodega-88", role: "WAREHOUSE", status: "ACTIVE" });
    const staff = await run(LOGIN, { i: { email: "almacen-cli@example.test", password: "Clave-de-bodega-88" } });
    expect(staff.data?.login).toMatchObject({ user: { role: "WAREHOUSE" } });
    expect((await authService.me((staff.data?.login as { token: string }).token))?.role).toBe("WAREHOUSE");
    const info = await run("{ checkoutInfo { customerAccounts } }");
    expect(info.data?.checkoutInfo).toEqual({ customerAccounts: false });
  });

  it("se sigue comprando y consultando el pedido sin cuenta", async () => {
    const payload = structuredClone(demoProducts[1]!); payload.slug = "sin-cuenta-1"; payload.variants = [{ ...payload.variants[0]!, stock: 3 }];
    const product = await productService.upsert(undefined, payload) as { id: string };
    const order = await orderService.create({ customer: { fullName: "Invitada de prueba", email: "invitada@example.test", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Dirección de prueba 123", idNumber: "1700000001", reference: "" }, items: [{ productId: product.id, variantSku: payload.variants[0]!.sku, quantity: 1 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" }) as { orderNumber: string };
    const tracked = await run("query($n:String!,$c:String!){ trackOrder(orderNumber:$n, contact:$c){ orderNumber } }", { n: order.orderNumber, c: "invitada@example.test" });
    expect(tracked.data?.trackOrder).toEqual({ orderNumber: order.orderNumber });
  });
});
