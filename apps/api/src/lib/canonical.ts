import { createHash } from "node:crypto";

// Huella de contenido independiente del orden de las propiedades (M35): dos clientes que envían
// los mismos datos en otro orden producen la misma huella. Los arreglos conservan su orden.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return `{${Object.keys(value as Record<string, unknown>).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
export const contentFingerprint = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
/** Clave de operación limitada a quien la usa: la misma clave de otra persona es otra operación. */
export const scopedOperationKey = (actorId: string, key: string) => createHash("sha256").update(`${actorId}:${key}`).digest("hex");
