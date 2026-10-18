import { ApolloServer } from "@apollo/server";
import { GraphQLError } from "graphql";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { redact } from "../services/audit.service.js";
import { assertJsonDepth, MAX_JSON_DEPTH } from "./jsonScalar.js";
import { publicError } from "./publicError.js";
import { resolvers } from "./resolvers.js";
import { typeDefs } from "./typeDefs.js";

// D04 y D09: JSON profundo antes de la autorización y errores públicos en producción.
const nested = (levels: number): unknown => { let value: unknown = 1; for (let i = 0; i < levels; i++) value = { a: value }; return value; };
const quiet = () => undefined;

describe("JSON profundo (D04)", () => {
  it("acepta hasta el máximo de niveles y rechaza más sin recursión", () => {
    expect(() => assertJsonDepth(nested(MAX_JSON_DEPTH))).not.toThrow();
    expect(() => assertJsonDepth(nested(MAX_JSON_DEPTH + 1))).toThrow(/demasiados niveles/);
    expect(() => assertJsonDepth(nested(200_000))).toThrow(/demasiados niveles/);
    expect(() => assertJsonDepth([[[[1]]]])).not.toThrow();
  });

  it("la bitácora corta los valores demasiado profundos en vez de agotar la pila", () => {
    expect(JSON.stringify(redact(nested(50_000)))).toContain("[TRUNCATED]");
    expect(redact({ password: "x", nested: { token: "y", ok: 1 } })).toEqual({ password: "[REDACTED]", nested: { token: "[REDACTED]", ok: 1 } });
  });

  it("una mutación anónima con JSON profundo recibe un error de entrada, no un error interno", async () => {
    const server = new ApolloServer({ typeDefs, resolvers });
    const context = { contextValue: { user: null, requestId: crypto.randomUUID(), ip: "203.0.113.90" } };
    const byVariable = await server.executeOperation({ query: 'mutation($v:JSON!){ saveExpense(id:"probe", input:$v) }', variables: { v: nested(4500) } }, context);
    const literal = `mutation { saveExpense(id:"probe", input:${"{a:".repeat(200)}1${"}".repeat(200)}) }`;
    const byLiteral = await server.executeOperation({ query: literal }, context);
    for (const [response, code] of [[byVariable, "BAD_USER_INPUT"], [byLiteral, "GRAPHQL_VALIDATION_FAILED"]] as const) {
      if (response.body.kind !== "single") throw new Error("Expected single result");
      const error = response.body.singleResult.errors?.[0];
      expect(error?.extensions?.code).toBe(code);
      expect(error?.message).toMatch(/demasiados niveles/);
    }
  });
});

describe("Errores públicos en producción (D09)", () => {
  const internal = (error: Error) => publicError({ message: error.message, extensions: { code: "INTERNAL_SERVER_ERROR" } }, error, quiet);

  it("conserva los mensajes escritos para las personas", () => {
    expect(publicError({ message: "Debes iniciar sesión", extensions: { code: "UNAUTHENTICATED" } }, new GraphQLError("Debes iniciar sesión"), quiet)).toEqual({ message: "Debes iniciar sesión", extensions: { code: "UNAUTHENTICATED" } });
    expect(internal(new Error("Producto no encontrado"))).toEqual({ message: "Producto no encontrado", extensions: { code: "INTERNAL_SERVER_ERROR" } });
  });

  it("oculta los fallos internos, de librería y de base de datos", () => {
    expect(internal(new RangeError("Maximum call stack size exceeded")).message).toBe("Error interno. Vuelve a intentarlo.");
    expect(internal(new TypeError("Cannot read properties of undefined (reading 'variants')")).message).toBe("Error interno. Vuelve a intentarlo.");
    const duplicate = Object.assign(new Error("E11000 duplicate key error collection: rawenergy.users index: email_1 dup key: { email: \"x@y.z\" }"), { name: "MongoServerError" });
    Object.setPrototypeOf(duplicate, class MongoServerError extends Error {}.prototype);
    expect(internal(duplicate).message).toBe("Error interno. Vuelve a intentarlo.");
    const outage = new (class MongooseError extends Error {})("Operation `orders.insertOne()` buffering timed out after 10000ms");
    expect(internal(outage)).toEqual({ message: "El servicio no está disponible por un momento. Vuelve a intentarlo en unos segundos.", extensions: { code: "SERVICE_UNAVAILABLE" } });
    const zod = z.object({ a: z.string() }).safeParse({ a: 1 });
    expect(internal(zod.error!)).toEqual({ message: "Datos de entrada inválidos.", extensions: { code: "BAD_USER_INPUT" } });
  });

  it("no repite el valor recibido en los errores de coerción de variables", () => {
    const formatted = { message: 'Variable "$i" got invalid value { email: { $ne: null } }; String cannot represent a non string value', extensions: { code: "BAD_USER_INPUT" } };
    expect(publicError(formatted, new GraphQLError(formatted.message), quiet)).toEqual({ message: "Datos de entrada inválidos.", extensions: { code: "BAD_USER_INPUT" } });
  });
});
