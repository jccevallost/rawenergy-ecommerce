import { randomUUID } from "node:crypto";
import { promises as dns } from "node:dns";
import { ApolloServer } from "@apollo/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { demoProducts } from "../data/demoProducts.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { emailDomainService } from "./emailDomain.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";

const customer = { fullName: "Persona de prueba", email: "cliente@example.test", phone: "0991234567", province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: "1700000001" };
let item: { productId: string; variantSku: string };
beforeAll(async () => {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `cliente-${randomUUID()}`;
  payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), stock: 50, price: 20 }];
  const { id } = await productService.upsert(undefined, payload) as { id: string };
  item = { productId: id, variantSku: payload.variants[0]!.sku };
});
afterEach(() => { vi.restoreAllMocks(); env.emailDomainCheck = "off"; });
const create = (changes: Record<string, unknown>, shippingMethod = "SERVIENTREGA_NATIONAL") => orderService.create({ idempotencyKey: randomUUID(), customer: { ...customer, ...changes }, items: [{ ...item, quantity: 1 }], shippingMethod, paymentMethod: "BANK_TRANSFER" }) as Promise<{ customer: typeof customer & { idNumber: string } }>;

describe("Datos de entrega validados en el servidor (C32)", () => {
  it("normaliza celular y ciudad por cabecera, y guarda solo los dígitos de la cédula", async () => {
    const order = await create({ phone: "+593 99 123 4567", city: "Sangolquí", idNumber: "170000000-1" });
    expect(order.customer).toMatchObject({ phone: "0991234567", city: "Rumiñahui", province: "Pichincha", idNumber: "1700000001" });
  });
  it.each([
    [{ phone: "0212345678" }, /celular/],
    [{ phone: "991234567" }, /celular/],
    [{ email: "cliente@gmail" }, /correo/],
    [{ email: "cliente" }, /correo/],
    [{ province: "Narnia" }, /provincia/],
    [{ province: "Guayas", city: "Quito" }, /ciudad/],
    [{ idNumber: "1700000002" }, /cédula|RUC/],
    [{ idNumber: "" }, /obligatoria/],
    [{ idNumber: undefined }, /obligatoria/],
    [{ idType: "CEDULA", idNumber: "1700000001001" }, /10 dígitos/],
    [{ idType: "PASAPORTE", idNumber: "AB#12" }, /pasaporte/],
    [{ idNumber: "AB123456" }, /tipo de identificación/]
  ])("rechaza %o", async (changes, message) => {
    await expect(create(changes)).rejects.toThrow(message);
  });
  it("express solo en Quito y Rumiñahui aunque se llame a la API directamente", async () => {
    await expect(create({ city: "Cayambe" }, "EXPRESS_QUITO_VALLES")).rejects.toThrow(/express/);
    await expect(create({ city: "Sangolquí" }, "EXPRESS_QUITO_VALLES")).resolves.toBeTruthy();
  });
});

describe("Identificación para la factura (C34)", () => {
  it("pasaporte de extranjero aceptado sin verificar; cédula y RUC con su tipo", async () => {
    expect((await create({ idType: "PASAPORTE", idNumber: "ab 123-456" })).customer).toMatchObject({ idType: "PASAPORTE", idNumber: "AB123456" });
    expect((await create({ idType: "RUC", idNumber: "1790000000001" })).customer).toMatchObject({ idType: "RUC", idNumber: "1790000000001" });
    expect((await create({ idNumber: "1700000001" })).customer).toMatchObject({ idType: "CEDULA" });
  });
});

describe("Dominio del correo (C32)", () => {
  const enable = () => { env.emailDomainCheck = "on"; };
  const failure = (code: string) => Object.assign(new Error(code), { code });
  it("rechaza dominios inexistentes y los que declaran no recibir correo (MX nulo)", async () => {
    enable();
    vi.spyOn(dns, "resolveMx").mockImplementation(async domain => { if (domain === "nulo.test") return [{ exchange: "", priority: 0 }]; throw failure("ENOTFOUND"); });
    expect(await emailDomainService.problem("ana@nulo.test")).toMatch(/no recibe correos/);
    expect(await emailDomainService.problem("ana@noexiste-rawenergy.test")).toMatch(/no recibe correos/);
  });
  it("acepta MX, o A sin MX, y no bloquea si el DNS no responde", async () => {
    enable();
    vi.spyOn(dns, "resolveMx").mockImplementation(async domain => {
      if (domain === "correo.test") return [{ exchange: "mx.correo.test", priority: 10 }];
      if (domain === "solo-a.test") throw failure("ENODATA");
      throw failure("ETIMEOUT");
    });
    vi.spyOn(dns, "resolve4").mockResolvedValue(["192.0.2.10"]);
    expect(await emailDomainService.problem("ana@correo.test")).toBeNull();
    expect(await emailDomainService.problem("ana@solo-a.test")).toBeNull();
    expect(await emailDomainService.problem("ana@lento.test")).toBeNull();
  });
  it("el pedido se rechaza con el dominio inválido y checkEmail sugiere correcciones", async () => {
    enable();
    vi.spyOn(dns, "resolveMx").mockRejectedValue(failure("ENOTFOUND"));
    await expect(create({ email: "ana@dominio-falso.test" })).rejects.toThrow(/no recibe correos/);
    const server = new ApolloServer({ typeDefs, resolvers });
    const response = await server.executeOperation({ query: "query($email:String!){ checkEmail(email:$email){ ok message suggestion } }", variables: { email: "ana@gmial.com" } }, { contextValue: { user: null, requestId: randomUUID(), ip: "10.20.0.1" } });
    if (response.body.kind !== "single") throw new Error("single");
    expect(response.body.singleResult.data).toMatchObject({ checkEmail: { ok: false, suggestion: "ana@gmail.com" } });
  });
});
