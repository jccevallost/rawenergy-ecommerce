// SEG-01: segundo factor obligatorio para el personal. Sin activarlo, la sesión solo sirve para activarlo.
import { ApolloServer } from "@apollo/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../config/env.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { currentStep, totpCode } from "../lib/totp.js";
import { authService, type AuthUser } from "./auth.service.js";

const server = new ApolloServer({ typeDefs, resolvers });
const run = async (query: string, variables: Record<string, unknown> = {}, user: AuthUser | null = null) => {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user, requestId: crypto.randomUUID(), ip: "203.0.113.95" } });
  if (response.body.kind !== "single") throw new Error("Expected single result");
  return response.body.singleResult;
};
const ME = "{ me { role twoFactorEnabled twoFactorRequired } }";
const SUPPLY = "{ supplyOverview }";
let admin: AuthUser;
const previous = env.STAFF_MFA;

beforeAll(async () => { authService.setPersistence(false); await authService.bootstrapAdmin(); admin = (await authService.users("ADMIN"))[0]!; });
afterAll(() => { env.STAFF_MFA = previous; });

describe("Segundo factor obligatorio para el personal (SEG-01)", () => {
  it("sin segundo factor la sesión solo permite activarlo; al activarlo se usa el panel", async () => {
    await authService.saveAccount(admin, undefined, { name: "Jefa de tienda", email: "jefa-mfa@example.test", password: "Clave-de-tienda-2026", role: "WAREHOUSE", status: "ACTIVE" });
    env.STAFF_MFA = "required";
    const session = await authService.login({ email: "jefa-mfa@example.test", password: "Clave-de-tienda-2026" });
    const actor = (await authService.me(session.token))!;
    expect((await run(ME, {}, actor)).data?.me).toEqual({ role: "WAREHOUSE", twoFactorEnabled: false, twoFactorRequired: true });
    const blocked = await run(SUPPLY, {}, actor);
    expect(blocked.errors?.[0]?.extensions?.code).toBe("MFA_SETUP_REQUIRED");
    expect(blocked.errors?.[0]?.message).toMatch(/Mi acceso/);
    expect((await run("{ staffHome }", {}, actor)).errors?.[0]?.extensions?.code).toBe("MFA_SETUP_REQUIRED");

    const setup = (await run("mutation { startTwoFactorSetup { secret otpauthUrl } }", {}, actor)).data!.startTwoFactorSetup as { secret: string };
    const confirmed = await run("mutation($c:String!){ confirmTwoFactorSetup(code:$c){ recoveryCodes } }", { c: totpCode(setup.secret, currentStep()) }, actor);
    expect(confirmed.errors).toBeUndefined();
    const ready = (await authService.me(session.token))!;
    expect(ready.twoFactorEnabled).toBe(true);
    expect((await run(SUPPLY, {}, ready)).errors).toBeUndefined();
  });

  it("los clientes no se ven afectados y en modo opcional el personal entra como antes", async () => {
    env.STAFF_MFA = "required";
    const customer = await authService.createVerifiedCustomer({ name: "Clienta de prueba", email: "clienta-mfa@example.test", password: "Marea-Azul-2026x" });
    const customerUser = (await authService.me(customer.token))!;
    expect((await run(ME, {}, customerUser)).data?.me).toEqual({ role: "CUSTOMER", twoFactorEnabled: false, twoFactorRequired: false });
    expect((await run("{ myOrders { id } }", {}, customerUser)).errors).toBeUndefined();

    env.STAFF_MFA = "optional";
    await authService.saveAccount(admin, undefined, { name: "Gerencia opcional", email: "gerencia-opcional@example.test", password: "Clave-de-gerencia-2026", role: "MANAGER", status: "ACTIVE" });
    const manager = (await authService.me((await authService.login({ email: "gerencia-opcional@example.test", password: "Clave-de-gerencia-2026" })).token))!;
    expect((await run(SUPPLY, {}, manager)).errors).toBeUndefined();
  });
});
