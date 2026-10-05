import { ApolloServer } from "@apollo/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { verifyHuman } from "../lib/turnstile.js";
import { mailService } from "./mail.service.js";
import { telegramService } from "./telegram.service.js";

vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

// C70: CAPTCHA con Cloudflare Turnstile, solo si están las dos claves.
const server = new ApolloServer({ typeDefs, resolvers });
const run = async (query: string, variables: Record<string, unknown>) => {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user: null, requestId: crypto.randomUUID(), ip: "203.0.113.90" } });
  if (response.body.kind !== "single") throw new Error("Expected single result");
  return response.body.singleResult;
};
const enable = () => { env.TURNSTILE_SITE_KEY = "1x00000000000000000000AA"; env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA"; };
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
afterEach(() => { env.TURNSTILE_SITE_KEY = undefined; env.TURNSTILE_SECRET_KEY = undefined; vi.unstubAllGlobals(); });

describe("Turnstile", () => {
  it("sin claves no pide nada y no se anuncia en checkoutInfo", async () => {
    await expect(verifyHuman(undefined)).resolves.toBeUndefined();
    const info = await run("{ checkoutInfo { captchaSiteKey } }", {});
    expect((info.data!.checkoutInfo as { captchaSiteKey: string | null }).captchaSiteKey).toBeNull();
  });

  it("con claves exige un token válido y deja pasar si Cloudflare no responde", async () => {
    enable();
    await expect(verifyHuman(undefined)).rejects.toThrow(/persona/);
    await expect(verifyHuman("token", "203.0.113.1", reply({ success: false, "error-codes": ["invalid-input-response"] }))).rejects.toThrow(/persona/);
    await expect(verifyHuman("token", "203.0.113.1", reply({ success: true }))).resolves.toBeUndefined();
    await expect(verifyHuman("token", "203.0.113.1", reply({}, 503))).resolves.toBeUndefined();
    const info = await run("{ checkoutInfo { captchaSiteKey } }", {});
    expect((info.data!.checkoutInfo as { captchaSiteKey: string }).captchaSiteKey).toBe("1x00000000000000000000AA");
  });

  it("protege el registro y los pedidos nuevos, no los reintentos del mismo pedido", async () => {
    enable();
    vi.stubGlobal("fetch", reply({ success: true }));
    const REGISTER = "mutation($i:RegisterInput!){ register(input:$i){ user { email } } }";
    const noToken = await run(REGISTER, { i: { name: "Sin token", email: "sin-token@example.test", password: "Clave-segura-99" } });
    expect(noToken.errors?.[0]?.extensions?.code).toBe("CAPTCHA_FAILED");
    expect((await run(REGISTER, { i: { name: "Con token", email: "con-token@example.test", password: "Clave-segura-99", captchaToken: "ok" } })).errors).toBeUndefined();

    const ORDER = "mutation($i:CheckoutInput!){ createCheckoutOrder(input:$i){ orderNumber } }";
    const input = { idempotencyKey: crypto.randomUUID(), customer: { fullName: "Persona real", email: "persona.real@correo.com", phone: "0994445566", province: "Pichincha", city: "Quito", address: "Av. Amazonas N34-100", idNumber: "1700000001" }, items: [{ productId: "demo-2", variantSku: "DP-CREATINE-300G", quantity: 1 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" };
    expect((await run(ORDER, { i: input })).errors?.[0]?.extensions?.code).toBe("CAPTCHA_FAILED");
    const created = await run(ORDER, { i: { ...input, captchaToken: "ok" } });
    expect(created.errors).toBeUndefined();
    // Reintento de la misma solicitud con el token ya usado: Cloudflare lo rechazaría, pero no se vuelve a verificar.
    vi.stubGlobal("fetch", reply({ success: false }));
    const retry = await run(ORDER, { i: { ...input, captchaToken: "ok" } });
    expect(retry.errors).toBeUndefined();
    expect(retry.data).toEqual(created.data);
  });
});
