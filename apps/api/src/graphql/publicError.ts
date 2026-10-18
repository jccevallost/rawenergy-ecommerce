import { unwrapResolverError } from "@apollo/server/errors";
import { GraphQLError, type GraphQLFormattedError } from "graphql";

// Errores que ve el público en producción (D04, D09). Se conservan los mensajes que el código
// escribe para las personas: GraphQLError propios y Error simples de las reglas de negocio
// («Producto no encontrado»). Lo que lanza una librería o el motor (pila agotada, MongoDB,
// TypeError, validación de Mongoose) sale con un mensaje fijo y se deja en el registro del
// servidor. Los errores de coerción de variables de GraphQL repiten el valor recibido: tampoco salen.
const unavailable = /buffering timed out|server selection|ECONNREFUSED|ECONNRESET|topology was destroyed/i;
const databaseNames = new Set(["MongoNetworkError", "MongoNetworkTimeoutError", "MongoServerSelectionError", "MongooseServerSelectionError", "MongoTopologyClosedError"]);

export function publicError(formatted: GraphQLFormattedError, error: unknown, log: (message: string, error: unknown) => void = console.error): GraphQLFormattedError {
  const code = formatted.extensions?.code;
  const original = unwrapResolverError(error);
  if (code === "BAD_USER_INPUT" && /^Variable "\$/.test(formatted.message)) return { message: "Datos de entrada inválidos.", extensions: { code } };
  if (code && code !== "INTERNAL_SERVER_ERROR") return { message: formatted.message, extensions: { code } };
  if (original instanceof GraphQLError || (original instanceof Error && original.constructor === Error)) return { message: formatted.message, extensions: { code: code ?? "INTERNAL_SERVER_ERROR" } };
  const name = original instanceof Error ? original.name : "";
  if (name === "ZodError") return { message: "Datos de entrada inválidos.", extensions: { code: "BAD_USER_INPUT" } };
  log("[api] error interno en GraphQL", original);
  if (databaseNames.has(name) || (original instanceof Error && unavailable.test(original.message))) {
    return { message: "El servicio no está disponible por un momento. Vuelve a intentarlo en unos segundos.", extensions: { code: "SERVICE_UNAVAILABLE" } };
  }
  return { message: "Error interno. Vuelve a intentarlo.", extensions: { code: "INTERNAL_SERVER_ERROR" } };
}
