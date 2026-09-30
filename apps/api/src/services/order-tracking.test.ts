import { randomUUID } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import depthLimit from "graphql-depth-limit";
import { describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { operationWidthRule } from "../graphql/validationRules.js";
import { operationRules } from "../lib/operationLimiter.js";
import { mailService } from "./mail.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { telegramService } from "./telegram.service.js";
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

const server = new ApolloServer({ typeDefs, resolvers, validationRules: [depthLimit(4), operationWidthRule] });
const TRACK = "query($n:String!,$c:String!){ trackOrder(orderNumber:$n, contact:$c) { orderNumber status reservedUntil total items { title quantity } } }";
async function track(n: string, c: string, ip = "203.0.113.90") {
  const response = await server.executeOperation({ query: TRACK, variables: { n, c } }, { contextValue: { user: null, requestId: randomUUID(), ip } });
  if (response.body.kind !== "single") throw new Error("single");
  return response.body.singleResult;
}

describe("Consulta de pedido para invitados", () => {
  it("devuelve el estado solo con el número y el correo o teléfono de la compra, sin datos personales", async () => {
    const payload = structuredClone(demoProducts[1]!); payload.slug = `seguimiento-${randomUUID()}`;
    payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), stock: 3, price: 25 }];
    const { id } = await productService.upsert(undefined, payload) as { id: string };
    const order = await orderService.create({ idempotencyKey: randomUUID(), customer: { fullName: "Ana Prueba", email: "Ana@Example.test", phone: "098 336 8127", province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: "1700000001" }, items: [{ productId: id, variantSku: payload.variants[0]!.sku, quantity: 1 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" }) as { orderNumber: string };
    for (const contact of ["ana@example.test", "+593 98 336 8127", "0983368127"]) {
      const result = await track(order.orderNumber.toLowerCase(), contact);
      expect(result.errors).toBeUndefined();
      expect(result.data?.trackOrder).toMatchObject({ orderNumber: order.orderNumber, status: "PENDING_PAYMENT", total: 29, items: [{ quantity: 1 }] });
      expect((result.data?.trackOrder as { reservedUntil: string }).reservedUntil).toBeTruthy();
    }
    for (const contact of ["otra@example.test", "0999999999", "8127"]) expect((await track(order.orderNumber, contact)).data?.trackOrder ?? null).toBeNull();
    expect((await track("RE-000000-XXXXX", "ana@example.test")).data?.trackOrder ?? null).toBeNull();
    const schema = await server.executeOperation({ query: "{ __type(name:\"TrackedOrder\") { fields { name } } }" }, { contextValue: { user: null, requestId: randomUUID(), ip: "203.0.113.91" } });
    if (schema.body.kind !== "single") throw new Error("single");
    const fields = (schema.body.singleResult.data as { __type: { fields: Array<{ name: string }> } }).__type.fields.map(field => field.name);
    expect(fields).not.toContain("customer");
  });

  it("limita los intentos por conexión para impedir adivinar pedidos", async () => {
    const codes: unknown[] = [];
    for (let i = 0; i < operationRules.orderLookup.limit + 1; i++) codes.push((await track(`RE-260926-${String(i).padStart(5, "0")}`, "alguien@example.test", "198.51.100.99")).errors?.[0]?.extensions?.code);
    expect(codes.at(-1)).toBe("RATE_LIMITED");
    expect(codes.slice(0, -1).every(code => code === undefined)).toBe(true);
  });
});
