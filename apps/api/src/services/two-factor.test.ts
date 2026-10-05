import { ApolloServer } from "@apollo/server";
import { beforeAll, describe, expect, it } from "vitest";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { base32Encode, currentStep, decryptSecret, encryptSecret, totpCode, verifyTotp } from "../lib/totp.js";
import { auditService } from "./audit.service.js";
import { authService, type AuthUser } from "./auth.service.js";

// C69 (S10): verificación en dos pasos del personal.
const server = new ApolloServer({ typeDefs, resolvers });
let admin: AuthUser;
const run = async (query: string, variables: Record<string, unknown> = {}, user: AuthUser | null = null, ip = "203.0.113.70") => {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user, requestId: crypto.randomUUID(), ip } });
  if (response.body.kind !== "single") throw new Error("Expected single result");
  return response.body.singleResult;
};
const LOGIN = "mutation($i:LoginInput!){ login(input:$i){ token user { twoFactorEnabled } } }";
beforeAll(async () => { authService.setPersistence(false); await authService.bootstrapAdmin(); admin = (await authService.users("ADMIN"))[0]!; });

describe("TOTP (RFC 6238)", () => {
  it("coincide con el vector oficial y acepta un paso de diferencia", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, 1)).toBe("287082"); // T = 59 s, SHA1
    const now = 59_000;
    expect(verifyTotp(secret, "287082", -1, now)).toBe(1);
    expect(verifyTotp(secret, totpCode(secret, 2), -1, now)).toBe(2);
    expect(verifyTotp(secret, totpCode(secret, 3), -1, now)).toBeNull();
    expect(verifyTotp(secret, "287082", 1, now)).toBeNull(); // ya usado
  });
  it("acepta códigos de recuperación escritos con 0 y 1 en lugar de O e I", async () => {
    const { hashRecoveryCode } = await import("../lib/totp.js");
    expect(hashRecoveryCode("O1IB-2OK7")).toBe(hashRecoveryCode("0118-20k7"));
  });
  it("guarda el secreto cifrado", () => {
    const stored = encryptSecret("JBSWY3DPEHPK3PXP", "clave-de-la-aplicacion");
    expect(stored).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(stored, "clave-de-la-aplicacion")).toBe("JBSWY3DPEHPK3PXP");
    expect(() => decryptSecret(stored, "otra-clave")).toThrow();
  });
});

describe("Verificación en dos pasos del personal", () => {
  it("alta, acceso con código, sin reutilizar, con recuperación, desactivación y reinicio por Administración", async () => {
    const staff = await authService.saveAccount(admin, undefined, { name: "Bodega dos pasos", email: "dos-pasos@example.test", password: "Clave-de-bodega-77", role: "WAREHOUSE", status: "ACTIVE" });
    const session = await authService.login({ email: staff.email, password: "Clave-de-bodega-77" });
    const actor = (await authService.me(session.token))!;
    const setup = (await run("mutation { startTwoFactorSetup { secret otpauthUrl } }", {}, actor)).data!.startTwoFactorSetup as { secret: string; otpauthUrl: string };
    expect(setup.otpauthUrl).toMatch(/^otpauth:\/\/totp\/.+secret=/);
    const wrongConfirm = await run("mutation($c:String!){ confirmTwoFactorSetup(code:$c){ recoveryCodes } }", { c: "000000" }, actor);
    expect(wrongConfirm.errors?.[0]?.message).toMatch(/no coincide/);
    const step = currentStep();
    const confirmed = await run("mutation($c:String!){ confirmTwoFactorSetup(code:$c){ recoveryCodes } }", { c: totpCode(setup.secret, step) }, actor);
    const recovery = (confirmed.data!.confirmTwoFactorSetup as { recoveryCodes: string[] }).recoveryCodes;
    expect(recovery).toHaveLength(8);

    const input = { email: staff.email, password: "Clave-de-bodega-77" };
    expect((await run(LOGIN, { i: input })).errors?.[0]?.extensions?.code).toBe("MFA_REQUIRED");
    expect((await run(LOGIN, { i: { ...input, code: totpCode(setup.secret, step) } })).errors?.[0]?.message).toMatch(/incorrecto o ya usado/);
    const next = await run(LOGIN, { i: { ...input, code: totpCode(setup.secret, step + 1) } });
    expect(next.errors).toBeUndefined();
    expect((next.data!.login as { user: { twoFactorEnabled: boolean } }).user.twoFactorEnabled).toBe(true);
    expect((await run(LOGIN, { i: { ...input, code: recovery[0] } })).errors).toBeUndefined();
    expect((await run(LOGIN, { i: { ...input, code: recovery[0] } })).errors?.[0]?.message).toMatch(/incorrecto o ya usado/);

    // Nada sensible en la bitácora.
    const events = JSON.stringify(await auditService.list({ search: "", limit: 100 }));
    expect(events).not.toContain(setup.secret);
    expect(events).not.toContain(recovery[1]!);

    expect((await run("mutation($c:String!){ disableTwoFactor(code:$c) }", { c: "123456" }, actor)).errors).toBeDefined();
    expect((await run("mutation($c:String!){ disableTwoFactor(code:$c) }", { c: recovery[1] }, actor)).errors).toBeUndefined();
    expect((await run(LOGIN, { i: input })).errors).toBeUndefined();

    // Administración quita el segundo factor de otra cuenta y cierra sus sesiones.
    const again = (await run("mutation { startTwoFactorSetup { secret } }", {}, actor)).data!.startTwoFactorSetup as { secret: string };
    await run("mutation($c:String!){ confirmTwoFactorSetup(code:$c){ recoveryCodes } }", { c: totpCode(again.secret, currentStep()) }, actor);
    expect((await run("mutation($id:ID!){ resetTwoFactor(id:$id) }", { id: staff.id }, actor)).errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    expect((await run("mutation($id:ID!){ resetTwoFactor(id:$id) }", { id: staff.id }, admin)).errors).toBeUndefined();
    expect(await authService.me(session.token)).toBeNull();
    expect((await run(LOGIN, { i: input })).errors).toBeUndefined();
  });

  it("no es para cuentas de cliente", async () => {
    const customer = await authService.register({ name: "Cliente dos pasos", email: "cliente-dos-pasos@example.test", password: "Clave-cliente-55" });
    const user = (await authService.me(customer.token))!;
    expect((await run("mutation { startTwoFactorSetup { secret } }", {}, user)).errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });
});
