import { afterEach, describe, expect, it, vi } from "vitest";
import { env, envProblems, envSchema } from "../config/env.js";
import { mailService } from "./mail.service.js";

// CU02: correo simulado de la fase de cuentas (decisión del propietario del 16/10/2026).
const original = { MAIL_MODE: env.MAIL_MODE };
afterEach(() => { Object.assign(env, original); mailService.clearSimulatedMailbox(); vi.restoreAllMocks(); });

describe("buzón simulado", () => {
  it("retiene el mensaje completo y solo anota el asunto en el log", async () => {
    Object.assign(env, { MAIL_MODE: "simulated" });
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const delivered = await mailService.sendPasswordReset("Ana@Correo.com", "https://tienda.test/#reset=token-secreto-123");
    expect(delivered).toBe(true);
    const [mail] = mailService.simulatedMailbox("ana@correo.com");
    expect(mail?.to).toBe("ana@correo.com");
    expect(mail?.html).toContain("token-secreto-123");
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).not.toContain("token-secreto-123");
    expect(logged).not.toContain("ana@correo.com");
  });

  it("filtra por destinatario y ordena del más reciente al más antiguo", async () => {
    Object.assign(env, { MAIL_MODE: "simulated" });
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await mailService.sendPasswordReset("a@correo.com", "https://tienda.test/#reset=1");
    await mailService.sendPasswordReset("b@correo.com", "https://tienda.test/#reset=2");
    await mailService.sendPasswordReset("a@correo.com", "https://tienda.test/#reset=3");
    const inbox = mailService.simulatedMailbox("a@correo.com");
    expect(inbox).toHaveLength(2);
    expect(inbox[0]?.html).toContain("reset=3");
    expect(mailService.simulatedMailbox()).toHaveLength(3);
  });

  it("no existe fuera del modo simulado", () => {
    Object.assign(env, { MAIL_MODE: "smtp" });
    expect(() => mailService.simulatedMailbox()).toThrow(/MAIL_MODE=simulated/);
  });

  it("cuenta como canal activo para avisos y confirmaciones", () => {
    Object.assign(env, { MAIL_MODE: "simulated" });
    expect(mailService.enabled).toBe(true);
  });
});

describe("configuración del correo simulado", () => {
  const parse = (values: Record<string, string>) => envProblems(envSchema.parse(values));

  it("se admite en desarrollo, pruebas y el perfil de staging de cuentas", () => {
    expect(parse({ MAIL_MODE: "simulated" })).toEqual([]);
    expect(parse({ MAIL_MODE: "simulated", NODE_ENV: "test" })).toEqual([]);
    expect(parse({ MAIL_MODE: "simulated", NODE_ENV: "production", RAWENERGY_DEPLOYMENT: "azure-staging-cuentas" })).toEqual([]);
  });

  it("se rechaza en producción real, en el staging general y junto a SMTP", () => {
    expect(parse({ MAIL_MODE: "simulated", NODE_ENV: "production" })).not.toEqual([]);
    expect(parse({ MAIL_MODE: "simulated", NODE_ENV: "production", RAWENERGY_DEPLOYMENT: "azure-staging" })).not.toEqual([]);
    expect(parse({ MAIL_MODE: "simulated", SMTP_HOST: "smtp.real.test" })).not.toEqual([]);
  });

  it("por omisión sigue el canal SMTP de siempre", () => {
    expect(envSchema.parse({}).MAIL_MODE).toBe("smtp");
    expect(parse({ NODE_ENV: "production" })).toEqual([]);
  });
});
