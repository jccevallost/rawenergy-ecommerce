import { ApolloServer } from "@apollo/server";
import crypto from "node:crypto";
import depthLimit from "graphql-depth-limit";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { operationWidthRule } from "../graphql/validationRules.js";
import { clientIp, ipKey } from "../lib/clientIp.js";
import { operationRules } from "../lib/operationLimiter.js";
import { passwordProblem } from "../lib/passwordPolicy.js";
import { createTrustedLogins } from "../lib/trustedLogins.js";
import { IMAGE_URL } from "../validation/product.js";
import { MAX_UNITS_PER_LINE } from "../validation/order.js";
import { authService, type AuthUser } from "./auth.service.js";
import { mailService } from "./mail.service.js";
import { orderService } from "./order.service.js";
import { createSecurityAlerts } from "./securityAlerts.service.js";
import { telegramService } from "./telegram.service.js";

vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

// Pruebas de C60 (parte 1 del cierre de etapa): controles de seguridad de la API.
const server = new ApolloServer({ typeDefs, resolvers, validationRules: [depthLimit(4), operationWidthRule] });
let admin: AuthUser;
async function execute(query: string, variables: Record<string, unknown> = {}, options: { user?: AuthUser | null; ip?: string } = {}) {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user: options.user ?? null, requestId: crypto.randomUUID(), ip: options.ip ?? "203.0.113.1" } });
  if (response.body.kind !== "single") throw new Error("Expected single result");
  return response.body.singleResult;
}
const LOGIN = "mutation($input:LoginInput!){login(input:$input){token}}";
const codeOf = (result: Awaited<ReturnType<typeof execute>>) => result.errors?.[0]?.extensions?.code;
beforeAll(async () => { authService.setPersistence(false); await authService.bootstrapAdmin(); admin = (await authService.users("ADMIN"))[0]!; });

describe("IP del visitante (S02)", () => {
  const prior = env.CLIENT_IP_HEADER;
  afterEach(() => { env.CLIENT_IP_HEADER = prior; });
  it("usa la cabecera del proxy de confianza solo si está configurada y es una IP", () => {
    const req = { ip: "10.0.0.1", headers: { "cf-connecting-ip": "198.51.100.7" } };
    env.CLIENT_IP_HEADER = undefined;
    expect(clientIp(req)).toBe("10.0.0.1");
    env.CLIENT_IP_HEADER = "cf-connecting-ip";
    expect(clientIp(req)).toBe("198.51.100.7");
    expect(clientIp({ ip: "10.0.0.1", headers: { "cf-connecting-ip": "no-es-ip" } })).toBe("10.0.0.1");
  });
  it("agrupa IPv6 por /64 y deja IPv4 (también la mapeada) tal cual", () => {
    expect(ipKey("2001:db8:1:2:aaaa::1")).toBe("2001:0db8:0001:0002::/64");
    expect(ipKey("2001:db8:1:2:ffff:ffff:ffff:fffe")).toBe("2001:0db8:0001:0002::/64");
    expect(ipKey("2001:db8:1:3::1")).not.toBe(ipKey("2001:db8:1:2::1"));
    expect(ipKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(ipKey("203.0.113.9")).toBe("203.0.113.9");
    expect(ipKey(undefined)).toBe("sin-ip");
  });
});

describe("Acceso y bloqueo de cuentas (S03, S07)", () => {
  it("los fallos de una conexión bloquean esa conexión para la cuenta, no a otras conexiones", async () => {
    const email = "pareja@example.test";
    for (let i = 0; i < operationRules.loginFailuresPair.limit; i++) await execute(LOGIN, { input: { email, password: `mala-${i}` } }, { ip: `198.51.100.${i < 4 ? 1 : 2}` });
    // 4 + 4 fallos desde dos conexiones: ninguna llegó a 8.
    expect(codeOf(await execute(LOGIN, { input: { email, password: "mala" } }, { ip: "198.51.100.1" }))).toBe("UNAUTHENTICATED");
    for (let i = 0; i < 4; i++) await execute(LOGIN, { input: { email, password: "mala" } }, { ip: "198.51.100.3" });
    for (let i = 0; i < 4; i++) await execute(LOGIN, { input: { email, password: "mala" } }, { ip: "198.51.100.3" });
    expect(codeOf(await execute(LOGIN, { input: { email, password: "mala" } }, { ip: "198.51.100.3" }))).toBe("RATE_LIMITED");
    expect(codeOf(await execute(LOGIN, { input: { email, password: "mala" } }, { ip: "198.51.100.4" }))).toBe("UNAUTHENTICATED");
  });

  it("un tercero no deja fuera a quien entra desde una conexión conocida", async () => {
    const owner = await authService.saveAccount(admin, undefined, { name: "Dueña", email: "duena@example.test", password: "Llave-propia-segura-1", role: "CATALOG", status: "ACTIVE" });
    expect(codeOf(await execute(LOGIN, { input: { email: owner.email, password: "Llave-propia-segura-1" } }, { ip: "192.0.2.10" }))).toBeUndefined();
    for (let i = 0; i < operationRules.loginFailures.limit; i++) await execute(LOGIN, { input: { email: owner.email, password: `ataque-${i}` } }, { ip: `192.0.2.${100 + (i % 50)}` });
    // Desde una conexión nueva la cuenta queda cerrada; desde la conocida, la contraseña correcta entra.
    expect(codeOf(await execute(LOGIN, { input: { email: owner.email, password: "Llave-propia-segura-1" } }, { ip: "192.0.2.250" }))).toBe("RATE_LIMITED");
    expect(codeOf(await execute(LOGIN, { input: { email: owner.email, password: "Llave-propia-segura-1" } }, { ip: "192.0.2.10" }))).toBeUndefined();
  });

  it("calcula scrypt también cuando la cuenta no existe", async () => {
    const verify = vi.spyOn(authService, "verifyPassword");
    await expect(authService.login({ email: "no-existe@example.test", password: "cualquier-cosa" })).rejects.toThrow(/incorrectos/);
    expect(verify).toHaveBeenCalledTimes(1);
    verify.mockRestore();
  });

  it("acepta hashes anteriores y los rehace al entrar", async () => {
    const created = await authService.saveAccount(admin, undefined, { name: "Hash viejo", email: "hash-viejo@example.test", password: "Contraseña-antigua-1", role: "CUSTOMER", status: "ACTIVE" });
    const salt = crypto.randomBytes(16).toString("base64url");
    const key = crypto.scryptSync("Contraseña-antigua-1", salt, 64);
    const memory = (authService as unknown as { memoryUsers: Array<{ id: string; passwordHash: string }> }).memoryUsers;
    const record = memory.find((user) => user.id === created.id)!;
    record.passwordHash = `scrypt:${salt}:${key.toString("base64url")}`;
    expect(authService.needsRehash(record.passwordHash)).toBe(true);
    await authService.login({ email: created.email, password: "Contraseña-antigua-1" });
    expect(record.passwordHash.startsWith("scrypt$16384$8$5$")).toBe(true);
    expect(authService.needsRehash(record.passwordHash)).toBe(false);
  });

  it("la sesión del personal dura 12 horas y la del cliente 7 días", async () => {
    const exp = (token: string) => JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).exp as number;
    const now = Math.floor(Date.now() / 1000);
    const staff = await authService.saveAccount(admin, undefined, { name: "Bodega turno", email: "turno@example.test", password: "Llave-de-bodega-22", role: "WAREHOUSE", status: "ACTIVE" });
    const staffToken = (await authService.login({ email: staff.email, password: "Llave-de-bodega-22" })).token;
    expect(exp(staffToken) - now).toBeGreaterThan(11 * 3600);
    expect(exp(staffToken) - now).toBeLessThanOrEqual(12 * 3600 + 5); // margen: el segundo puede cambiar entre medir y firmar
    const customer = await authService.register({ name: "Cliente sesión", email: "cliente-sesion@example.test", password: "Clave-cliente-1" });
    expect(exp(customer.token) - now).toBeGreaterThan(6 * 86400);
  });
});

describe("Política de contraseñas (S11)", () => {
  it("pide 12 caracteres al personal, 8 a clientes y rechaza las comunes o con el correo", () => {
    expect(passwordProblem("Clave-123", {})).toBeNull();
    expect(passwordProblem("Clave-123", { staff: true })).toMatch(/12 caracteres/);
    expect(passwordProblem("password123", {})).toMatch(/más usadas/);
    expect(passwordProblem("Contraseña123", {})).toMatch(/más usadas/);
    expect(passwordProblem("aaaaaaaaaaaa", {})).toMatch(/repetido/);
    expect(passwordProblem("ventas-2026-ok", { email: "ventas@tienda.ec" })).toMatch(/correo/);
    expect(passwordProblem("Una-frase-larga-y-propia", { staff: true, email: "ana@tienda.ec", name: "Ana Pérez" })).toBeNull();
  });

  it("se aplica al registrarse, al crear personal y al dar acceso al panel a un cliente", async () => {
    await expect(authService.register({ name: "Débil", email: "debil@example.test", password: "12345678" })).rejects.toThrow(/más usadas/);
    await expect(authService.saveAccount(admin, undefined, { name: "Corta", email: "corta@example.test", password: "Corta-123", role: "CATALOG", status: "ACTIVE" })).rejects.toThrow(/12 caracteres/);
    const customer = (await authService.register({ name: "Futuro personal", email: "futuro@example.test", password: "Clave-cliente-9" })).user;
    await expect(authService.saveAccount(admin, customer.id, { name: customer.name, email: customer.email, role: "CATALOG", status: "ACTIVE" })).rejects.toThrow(/contraseña nueva/);
    await expect(authService.setUserRole(admin, customer.id, "MANAGER")).rejects.toThrow(/contraseña nueva/);
    const promoted = await authService.saveAccount(admin, customer.id, { name: customer.name, email: customer.email, role: "CATALOG", status: "ACTIVE", password: "Clave-del-panel-77" });
    expect(promoted.role).toBe("CATALOG");
  });
});

describe("Datos públicos del catálogo (S12)", () => {
  const QUERY = "{ searchProducts(pagination:{first:50}) { edges { node { variants { sku stock reorderPoint } } } } }";
  it("el público ve existencias acotadas y sin punto de reposición; el personal, las exactas", async () => {
    const publicRows = (await execute(QUERY)).data as { searchProducts: { edges: Array<{ node: { variants: Array<{ stock: number; reorderPoint: number | null }> } }> } };
    const staffRows = (await execute(QUERY, {}, { user: admin })).data as typeof publicRows;
    const pub = publicRows.searchProducts.edges.flatMap((edge) => edge.node.variants);
    const staff = staffRows.searchProducts.edges.flatMap((edge) => edge.node.variants);
    expect(pub.every((variant) => variant.stock <= MAX_UNITS_PER_LINE && variant.reorderPoint === null)).toBe(true);
    expect(staff.some((variant) => variant.stock > MAX_UNITS_PER_LINE)).toBe(true);
    expect(staff.some((variant) => variant.reorderPoint !== null)).toBe(true);
  });
});

describe("Pedidos: acaparamiento y número (S04, S17)", () => {
  const customer = { fullName: "Persona acaparadora", email: "acapara@correo.com", phone: "0991112233", province: "Pichincha", city: "Quito", address: "Av. Amazonas N34-100", idNumber: "1700000001" };
  const order = (quantity = 1, overrides: Partial<typeof customer> = {}) => ({ customer: { ...customer, ...overrides }, items: [{ productId: "demo-2", variantSku: "DP-CREATINE-300G", quantity }], shippingMethod: "EXPRESS_QUITO_VALLES" as const, paymentMethod: "BANK_TRANSFER" as const });
  const prior = env.MAX_PENDING_ORDERS_PER_CUSTOMER;
  afterEach(() => { env.MAX_PENDING_ORDERS_PER_CUSTOMER = prior; });

  it("limita los pedidos pendientes por documento, celular o correo y libera el cupo al cancelar", async () => {
    env.MAX_PENDING_ORDERS_PER_CUSTOMER = 2;
    const first = await orderService.create(order()) as { id?: string; _id?: unknown; orderNumber: string };
    await orderService.create(order(1, { email: "otro@correo.com", phone: "0991112244" }));
    // Mismo documento con otro correo y otro celular: cuenta igual.
    await expect(orderService.create(order(1, { email: "tercero@correo.com", phone: "0991112255" }))).rejects.toThrow(/pedidos pendientes/);
    await orderService.updateStatus(String(first.id ?? first._id), "CANCELLED");
    await expect(orderService.create(order(1, { email: "tercero@correo.com", phone: "0991112255" }))).resolves.toBeTruthy();
    expect(first.orderNumber).toMatch(/^RE-\d{6}-[A-Z0-9]{6}$/);
  });

  it(`rechaza más de ${MAX_UNITS_PER_LINE} unidades por presentación`, async () => {
    await expect(orderService.create(order(MAX_UNITS_PER_LINE + 1, { idNumber: "1710034065", email: "mayorista@correo.com", phone: "0993334455" }))).rejects.toThrow(/Máximo 20 unidades|too_big/);
    const totals = await execute("query($items:[CartItemInput!]!){ calculateCartTotals(cartItems:$items){ total } }", { items: [{ productId: "demo-2", variantSku: "DP-CREATINE-300G", quantity: MAX_UNITS_PER_LINE + 1 }] });
    expect(codeOf(totals)).toBe("BAD_USER_INPUT");
  });
});

describe("Alertas de seguridad (S15)", () => {
  it("avisa una vez por ventana de los fallos contra cuentas del personal, no de clientes", async () => {
    let clock = 0;
    const sent: string[] = [];
    const alerts = createSecurityAlerts({ now: () => clock, roleOf: async (email) => email.startsWith("staff") ? "ADMIN" : "CUSTOMER", send: async (_label, text) => { sent.push(text); } });
    for (let i = 0; i < 8; i++) { alerts.loginFailed("staff@tienda.ec", "203.0.113.5"); alerts.loginFailed("cliente@correo.com", "203.0.113.6"); clock += 1000; }
    await alerts.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/staff@tienda\.ec.*Administración/);
    clock += 16 * 60_000;
    for (let i = 0; i < 5; i++) alerts.loginFailed("staff@tienda.ec", "203.0.113.5");
    await alerts.flush();
    expect(sent).toHaveLength(2);
  });

  it("avisa de picos de rechazos y de cambios de acceso del personal", async () => {
    let clock = 0;
    const sent: string[] = [];
    const alerts = createSecurityAlerts({ now: () => clock, send: async (_label, text) => { sent.push(text); } });
    for (let i = 0; i < 29; i++) alerts.rateLimited("prueba");
    expect(sent).toHaveLength(0);
    for (let i = 0; i < 40; i++) alerts.rateLimited("prueba");
    expect(sent).toHaveLength(1);
    alerts.staffAccess({ name: "Admin", email: "admin@tienda.ec" }, null, { name: "Nueva", email: "nueva@tienda.ec", role: "WAREHOUSE" });
    alerts.staffAccess({ name: "Admin", email: "admin@tienda.ec" }, { role: "WAREHOUSE" }, { name: "Nueva", email: "nueva@tienda.ec", role: "WAREHOUSE" });
    alerts.staffAccess({ name: "Admin", email: "admin@tienda.ec" }, null, { name: "Cliente", email: "c@correo.com", role: "CUSTOMER" });
    await alerts.flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/se creó con el rol Bodega/);
  });
});

describe("Imágenes y errores (S13, S20)", () => {
  it("acepta https, rutas propias y fotos de la biblioteca; rechaza http ajeno e incrustadas", () => {
    expect(IMAGE_URL.test("https://cdn.example.com/a.webp")).toBe(true);
    expect(IMAGE_URL.test("/assets/products/a.webp")).toBe(true);
    expect(IMAGE_URL.test(`http://localhost:4000/media/${"a".repeat(32)}`)).toBe(true);
    expect(IMAGE_URL.test("http://example.com/a.png")).toBe(false);
    expect(IMAGE_URL.test("//example.com/a.png")).toBe(false);
    expect(IMAGE_URL.test("data:image/png;base64,AAAA")).toBe(false);
  });

  it("sin sugerencias de campos cuando se ocultan los detalles del esquema", async () => {
    const hidden = new ApolloServer({ typeDefs, resolvers, hideSchemaDetailsFromClientErrors: true });
    const response = await hidden.executeOperation({ query: "{ produc { title } }" }, { contextValue: { user: null, requestId: "x", ip: "203.0.113.1" } });
    const message = response.body.kind === "single" ? response.body.singleResult.errors?.[0]?.message : "";
    expect(message).not.toMatch(/Did you mean/);
  });
});

describe("Conexiones de confianza", () => {
  it("vencen a los 30 días y guardan como máximo 10 por cuenta", () => {
    let clock = 0;
    const trusted = createTrustedLogins(() => clock);
    for (let i = 0; i < 12; i++) trusted.remember("cuenta", `ip-${i}`);
    expect(trusted.has("cuenta", "ip-0")).toBe(false);
    expect(trusted.has("cuenta", "ip-11")).toBe(true);
    clock += 31 * 24 * 3600_000;
    expect(trusted.has("cuenta", "ip-11")).toBe(false);
  });
});
