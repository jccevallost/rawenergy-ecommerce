import { ApolloServer } from "@apollo/server";
import depthLimit from "graphql-depth-limit";
import { GraphQLError } from "graphql";
import { beforeAll, describe, expect, it } from "vitest";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { MAX_ROOT_FIELDS, operationWidthRule } from "../graphql/validationRules.js";
import { authService } from "../services/auth.service.js";
import { createOperationLimiter, operationRules } from "./operationLimiter.js";

const server = new ApolloServer({ typeDefs, resolvers, validationRules: [depthLimit(4), operationWidthRule] });
async function execute(query: string, variables: Record<string, unknown> = {}, ip = "203.0.113.10") {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user: null, requestId: crypto.randomUUID(), ip } });
  if (response.body.kind !== "single") throw new Error("Expected single result");
  return response.body.singleResult;
}
const LOGIN = "mutation($input:LoginInput!){login(input:$input){token}}";
beforeAll(async () => { authService.setPersistence(false); await authService.bootstrapAdmin(); });

describe("Limitador por operación", () => {
  it("rechaza al superar el cupo y vuelve a aceptar cuando vence la ventana", () => {
    let clock = 0;
    const limiter = createOperationLimiter(operationRules, () => clock);
    for (let i = 0; i < operationRules.register.limit; i++) limiter.consume("register", "ip");
    expect(() => limiter.consume("register", "ip")).toThrowError(GraphQLError);
    try { limiter.consume("register", "ip"); } catch (error) {
      expect((error as GraphQLError).extensions.code).toBe("RATE_LIMITED");
      expect((error as GraphQLError).extensions.retryAfter).toBe(3600);
    }
    // Otra IP y otra operación mantienen su propio cupo.
    expect(() => limiter.consume("register", "otra-ip")).not.toThrow();
    expect(() => limiter.consume("checkout", "ip")).not.toThrow();
    clock += operationRules.register.windowMs + 1;
    expect(() => limiter.consume("register", "ip")).not.toThrow();
  });

  it("assert no cuenta el intento y reset libera la clave", () => {
    const limiter = createOperationLimiter(operationRules, () => 0);
    for (let i = 0; i < 20; i++) limiter.assert("loginFailures", "cuenta");
    for (let i = 0; i < operationRules.loginFailures.limit; i++) limiter.hit("loginFailures", "cuenta");
    expect(() => limiter.assert("loginFailures", "cuenta")).toThrow(/fallidos/);
    limiter.reset("loginFailures", "cuenta");
    expect(() => limiter.assert("loginFailures", "cuenta")).not.toThrow();
  });

  it("libera la memoria de claves vencidas", () => {
    let clock = 0;
    const limiter = createOperationLimiter(operationRules, () => clock);
    for (let i = 0; i < 400; i++) limiter.hit("cartTotals", `ip-${i}`);
    clock += 61 * 60_000;
    for (let i = 0; i < 100; i++) limiter.hit("cartTotals", "activa");
    expect(limiter.size()).toBe(1);
  });
});

describe("Abuso a través de GraphQL", () => {
  it("una petición no puede agrupar varios accesos con alias", async () => {
    const aliases = Array.from({ length: 50 }, (_, i) => `a${i}: login(input:{email:"admin@rawenergy.ec",password:"intento-${i}"}){token}`).join(" ");
    const result = await execute(`mutation { ${aliases} }`);
    expect(result.data).toBeUndefined();
    expect(result.errors?.map(error => error.message)).toContain("La solicitud pide 50 operaciones; el máximo es 10.");
    expect(result.errors?.map(error => error.message)).toContain("Solo se permite un acceso, registro o pedido por solicitud.");
  });

  it("tampoco puede combinar un pedido con otro acceso ni pedir más campos raíz que el máximo", async () => {
    const mixed = await execute('mutation { login(input:{email:"a@b.co",password:"x"}){token} register(input:{name:"Ana",email:"a@b.co",password:"12345678"}){token} }');
    expect(mixed.errors?.[0]?.message).toBe("Solo se permite un acceso, registro o pedido por solicitud.");
    const wide = await execute(`{ ${Array.from({ length: MAX_ROOT_FIELDS + 1 }, (_, i) => `h${i}: health`).join(" ")} }`);
    expect(wide.errors?.[0]?.message).toMatch(/el máximo es 10/);
    const allowed = await execute(`{ ${Array.from({ length: MAX_ROOT_FIELDS }, (_, i) => `h${i}: health`).join(" ")} }`);
    expect(allowed.errors).toBeUndefined();
  });

  it("peticiones de acceso repetidas desde una IP terminan en RATE_LIMITED sin revelar si la cuenta existe", async () => {
    const codes: unknown[] = [];
    for (let i = 0; i < operationRules.login.limit + 2; i++) {
      const result = await execute(LOGIN, { input: { email: `persona${i}@example.test`, password: "incorrecta" } }, "198.51.100.7");
      codes.push(result.errors?.[0]?.extensions?.code);
    }
    expect(codes.slice(0, operationRules.login.limit).every(code => code === "UNAUTHENTICATED")).toBe(true);
    expect(codes.slice(operationRules.login.limit)).toEqual(["RATE_LIMITED", "RATE_LIMITED"]);
    // Otra conexión no queda bloqueada por la primera.
    const other = await execute(LOGIN, { input: { email: "otra@example.test", password: "incorrecta" } }, "198.51.100.8");
    expect(other.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });

  it("los fallos repartidos entre IP bloquean la cuenta atacada, no otras", async () => {
    const target = "victima@example.test";
    for (let i = 0; i < operationRules.loginFailures.limit; i++) {
      await execute(LOGIN, { input: { email: target, password: `intento-${i}` } }, `192.0.2.${i + 1}`);
    }
    const blocked = await execute(LOGIN, { input: { email: target, password: "otro" } }, "192.0.2.200");
    expect(blocked.errors?.[0]?.extensions?.code).toBe("RATE_LIMITED");
    const unrelated = await execute(LOGIN, { input: { email: "otra-cuenta@example.test", password: "x" } }, "192.0.2.201");
    expect(unrelated.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });

  it("ráfagas de pedidos desde una IP se detienen antes de llegar al servicio", async () => {
    // Estructura GraphQL válida y contenido inválido: llega al resolver y el servicio lo rechaza.
    const customer = { fullName: "Persona", email: "persona@example.test", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: "1700000001" };
    const input = { idempotencyKey: "clave", customer, items: [], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" };
    const codes: unknown[] = [];
    for (let i = 0; i < operationRules.checkout.limit + 1; i++) {
      const result = await execute("mutation($input:CheckoutInput!){createCheckoutOrder(input:$input){id}}", { input: { ...input, idempotencyKey: `clave-${i}` } }, "198.51.100.50");
      codes.push(result.errors?.[0]?.extensions?.code);
    }
    expect(codes.at(-1)).toBe("RATE_LIMITED");
    expect(codes.slice(0, -1)).not.toContain("RATE_LIMITED");
  });
});
