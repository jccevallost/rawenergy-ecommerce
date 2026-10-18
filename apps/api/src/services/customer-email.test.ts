import { randomUUID } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { authService, type AuthUser } from "./auth.service.js";
import { mailService } from "./mail.service.js";

// CU04: verificación de correo simulada, cambio de correo, recuperación de tienda y sesiones (D05, D10).
const server = new ApolloServer({ typeDefs, resolvers });
type Result = { data?: Record<string, any> | null; errors?: Array<{ message: string; extensions?: { code?: string; field?: string } }> };
async function run(query: string, variables: Record<string, unknown> = {}, user: AuthUser | null = null): Promise<Result> {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user: user as never, requestId: randomUUID(), ip: `198.51.100.${Math.floor(Math.random() * 250)}` } });
  if (response.body.kind !== "single") throw new Error("single");
  return response.body.singleResult as Result;
}
const REGISTER = "mutation($i: RegisterInput!) { register(input: $i) { accepted deliveryAvailable } }";
const VERIFY = "mutation($t: String!) { verifyEmail(token: $t) }";
const RESEND = "mutation($e: String!) { resendVerification(email: $e) { accepted } }";
const CHANGE = "mutation($e: String!, $p: String!) { requestEmailChange(email: $e, password: $p) { accepted } }";
const CONFIRM = "mutation($t: String!) { confirmEmailChange(token: $t) }";
const LOGIN = "mutation($i: LoginInput!) { login(input: $i) { token user { email emailVerified } } }";

const memory = () => (authService as unknown as { memoryUsers: Array<Record<string, any>> }).memoryUsers;
const record = (email: string) => memory().find(u => u.email === email)!;
const email = (tag: string) => `${tag}-${randomUUID().slice(0, 8)}@example.test`;
const PASSWORD = "Cuenta-segura-2026";
const linkFrom = (to: string, key: string) => {
  const html = mailService.simulatedMailbox(to).find(m => m.html.includes(`#${key}=`))?.html ?? "";
  return decodeURIComponent(/#[a-z-]+=([^"&]+)/.exec(html.slice(html.indexOf(`#${key}=`)))?.[1] ?? "");
};
const age = (field: string, user: Record<string, any>) => { user[field] = new Date(Date.now() - 5 * 60_000); };

const original = { MAIL_MODE: env.MAIL_MODE, STORE_URL: env.STORE_URL };
beforeAll(() => { Object.assign(env, { MAIL_MODE: "simulated", STORE_URL: "https://tienda.example.test" }); });
afterAll(() => { Object.assign(env, original); mailService.clearSimulatedMailbox(); });
beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => undefined); });

async function verifiedAccount() {
  const address = email("verificada");
  await run(REGISTER, { i: { name: "Ana Pérez", email: address, password: PASSWORD } });
  await authService.flushBackground();
  expect((await run(VERIFY, { t: linkFrom(address, "verificar") })).data?.verifyEmail).toBe(true);
  const login = await run(LOGIN, { i: { email: address, password: PASSWORD } });
  return { address, token: login.data!.login.token as string, user: (await authService.me(login.data!.login.token))! };
}

describe("alta con respuesta uniforme (D05)", () => {
  it("responde igual para un correo nuevo y uno existente, sin iniciar sesión", async () => {
    const fresh = email("nueva");
    const { address: taken } = await verifiedAccount();
    age("verifyRequestedAt", record(taken)); // Pasó el minuto entre avisos al mismo correo.
    const a = await run(REGISTER, { i: { name: "Persona nueva", email: fresh, password: PASSWORD } });
    const b = await run(REGISTER, { i: { name: "Otra persona", email: taken, password: PASSWORD } });
    expect(a).toEqual(b);
    expect(a.data?.register).toEqual({ accepted: true, deliveryAvailable: true });
    await authService.flushBackground();
    expect(mailService.simulatedMailbox(fresh)[0]?.subject).toBe("Confirma tu correo");
    expect(mailService.simulatedMailbox(taken)[0]?.subject).toBe("Ya tienes una cuenta");
    // La cuenta existente conserva su contraseña.
    expect((await run(LOGIN, { i: { email: taken, password: PASSWORD } })).errors).toBeUndefined();
  });

  it("los errores que solo dependen de lo escrito se responden en el momento", async () => {
    const weak = await run(REGISTER, { i: { name: "Ana", email: email("debil"), password: "12345678" } });
    expect(weak.errors?.[0]?.extensions?.field).toBe("password");
  });
});

describe("confirmación del correo", () => {
  it("sin confirmar no entra; el acceso con la contraseña correcta reenvía el enlace", async () => {
    const address = email("pendiente");
    await run(REGISTER, { i: { name: "Ana Pérez", email: address, password: PASSWORD } });
    await authService.flushBackground();
    const denied = await run(LOGIN, { i: { email: address, password: PASSWORD } });
    expect(denied.errors?.[0]?.extensions?.code).toBe("EMAIL_NOT_VERIFIED");
    // Contraseña incorrecta: el mismo error de siempre, sin revelar que falta confirmar.
    expect((await run(LOGIN, { i: { email: address, password: "Otra-clave-2026" } })).errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    age("verifyRequestedAt", record(address));
    await run(LOGIN, { i: { email: address, password: PASSWORD } });
    await authService.flushBackground();
    expect(mailService.simulatedMailbox(address).filter(m => m.subject === "Confirma tu correo")).toHaveLength(2);
  });

  it("el enlace sirve una vez; uno vencido o inventado no sirve", async () => {
    const address = email("enlace");
    await run(REGISTER, { i: { name: "Ana Pérez", email: address, password: PASSWORD } });
    await authService.flushBackground();
    const token = linkFrom(address, "verificar");
    expect(mailService.simulatedMailbox(address)[0]?.html).toContain("https://tienda.example.test/#verificar=");
    expect((await run(VERIFY, { t: token })).data?.verifyEmail).toBe(true);
    expect((await run(VERIFY, { t: token })).errors?.[0]?.extensions?.field).toBe("token");
    expect((await run(VERIFY, { t: "x".repeat(43) })).errors?.[0]?.extensions?.field).toBe("token");
    const login = await run(LOGIN, { i: { email: address, password: PASSWORD } });
    expect(login.data?.login.user).toEqual({ email: address, emailVerified: true });

    const late = email("vencido");
    await run(REGISTER, { i: { name: "Ana Pérez", email: late, password: PASSWORD } });
    await authService.flushBackground();
    record(late).verifyExpiresAt = new Date(Date.now() - 1000);
    expect((await run(VERIFY, { t: linkFrom(late, "verificar") })).errors).toBeDefined();
  });

  it("el reenvío responde igual exista o no la cuenta y respeta un minuto entre envíos", async () => {
    const address = email("reenvio");
    await run(REGISTER, { i: { name: "Ana Pérez", email: address, password: PASSWORD } });
    await authService.flushBackground();
    const known = await run(RESEND, { e: address });
    const unknown = await run(RESEND, { e: email("nadie") });
    expect(known).toEqual(unknown);
    await authService.flushBackground();
    expect(mailService.simulatedMailbox(address)).toHaveLength(1);
  });

  it("una sesión de cliente sin correo confirmado no vale", async () => {
    const created = await authService.createVerifiedCustomer({ name: "Ana Pérez", email: email("antigua"), password: PASSWORD });
    expect(await authService.me(created.token)).toBeTruthy();
    record(created.user.email).emailVerifiedAt = null;
    expect(await authService.me(created.token)).toBeNull();
  });
});

describe("cambio de correo", () => {
  it("exige la contraseña, mantiene el correo hasta confirmar y luego cierra las sesiones", async () => {
    const { address, token, user } = await verifiedAccount();
    const target = email("nuevo");
    expect((await run(CHANGE, { e: target, p: "Clave-incorrecta-1" }, user)).errors?.[0]?.extensions?.field).toBe("password");
    expect((await run(CHANGE, { e: address, p: PASSWORD }, user)).errors?.[0]?.extensions?.field).toBe("email");
    expect((await run(CHANGE, { e: target, p: PASSWORD }, user)).data?.requestEmailChange.accepted).toBe(true);
    await authService.flushBackground();
    expect(record(address).email).toBe(address);
    expect(mailService.simulatedMailbox(address).map(m => m.subject)).toContain("Solicitud de cambio de correo");
    expect(mailService.simulatedMailbox(address).find(m => m.subject === "Solicitud de cambio de correo")?.html).not.toContain(target);
    const link = linkFrom(target, "cambio-correo");
    expect((await run(CONFIRM, { t: link })).data?.confirmEmailChange).toBe(true);
    expect(await authService.me(token)).toBeNull();
    expect((await run(CONFIRM, { t: link })).errors).toBeDefined();
    expect((await run(LOGIN, { i: { email: target, password: PASSWORD } })).data?.login.user.email).toBe(target);
    await authService.flushBackground();
    expect(mailService.simulatedMailbox(address).map(m => m.subject)).toContain("Tu correo de acceso cambió");
  });

  it("hacia un correo con cuenta responde igual y solo avisa a su titular", async () => {
    const { address: taken } = await verifiedAccount();
    const { user } = await verifiedAccount();
    expect((await run(CHANGE, { e: taken, p: PASSWORD }, user)).data?.requestEmailChange.accepted).toBe(true);
    await authService.flushBackground();
    expect(record(user.email).pendingEmail).toBeUndefined();
    expect(mailService.simulatedMailbox(taken)[0]?.subject).toBe("Ya tienes una cuenta");
  });

  it("dos cuentas que piden el mismo correo libre: solo la primera en confirmar lo obtiene", async () => {
    const first = await verifiedAccount(), second = await verifiedAccount();
    const target = email("disputado");
    await run(CHANGE, { e: target, p: PASSWORD }, first.user);
    await run(CHANGE, { e: target, p: PASSWORD }, second.user);
    await authService.flushBackground();
    const [linkSecond, linkFirst] = mailService.simulatedMailbox(target).map(m => decodeURIComponent(/#cambio-correo=([^"&]+)/.exec(m.html)![1]!));
    expect((await run(CONFIRM, { t: linkFirst })).data?.confirmEmailChange).toBe(true);
    const lost = await run(CONFIRM, { t: linkSecond });
    expect(lost.errors?.[0]?.message).toMatch(/ya está en uso/);
    expect(record(second.address).email).toBe(second.address);
    expect(memory().filter(u => u.email === target)).toHaveLength(1);
  });

  it("solo una cuenta de cliente con sesión puede pedirlo", async () => {
    expect((await run(CHANGE, { e: email("x"), p: PASSWORD })).errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });
});

describe("recuperación de la contraseña del cliente", () => {
  it("el enlace lleva a la tienda y usarlo también confirma el correo", async () => {
    const address = email("recupera");
    await run(REGISTER, { i: { name: "Ana Pérez", email: address, password: PASSWORD } });
    await authService.flushBackground();
    await run("mutation($e: String!) { requestPasswordReset(email: $e) }", { e: address });
    await authService.flushBackground();
    const reset = mailService.simulatedMailbox(address).find(m => m.subject === "Restablecer contraseña")!;
    expect(reset.html).toContain("https://tienda.example.test/#restablecer=");
    const token = decodeURIComponent(/#restablecer=([^"&]+)/.exec(reset.html)![1]!);
    expect((await run("mutation($t: String!, $p: String!) { resetPassword(token: $t, password: $p) }", { t: token, p: "Nueva-clave-2026x" })).errors).toBeUndefined();
    expect((await run(LOGIN, { i: { email: address, password: "Nueva-clave-2026x" } })).data?.login.user.emailVerified).toBe(true);
  });
});
