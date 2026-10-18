// VER-01 (M47): versión mínima por plataforma de cliente. Cada cliente envía `x-rawenergy-client:
// <plataforma>/<versión>`; las apps nativas marcan su agente de usuario y el panel o la tienda lo reenvían.
// Una versión inferior a la mínima puede consultar, pero no escribir: así nadie opera con reglas viejas y
// tampoco queda sin ver sus datos. Sin cabecera (clientes web y guiones) no se aplica ninguna mínima.
import { parse } from "graphql";

export type ClientInfo = { platform: string; version: string };
export function parseClient(header: unknown): ClientInfo | null {
  const match = typeof header === "string" ? /^([a-z][a-z-]{1,30})\/(\d{1,4}\.\d{1,4}\.\d{1,4})$/.exec(header.trim()) : null;
  return match ? { platform: match[1]!, version: match[2]! } : null;
}
const compare = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!; return 0; };

/** `MIN_CLIENT_VERSIONS`: JSON como {"panel-windows":"1.0.0","panel-android":"1.0.0"}. */
export function minimumVersions(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).filter(([k, v]) => /^[a-z][a-z-]{1,30}$/.test(k) && typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v))) as Record<string, string>;
  } catch { console.error("[api] MIN_CLIENT_VERSIONS no es un JSON válido; no se aplican mínimas."); return {}; }
}
export function isOutdated(client: ClientInfo | null, minimums: Record<string, string>) {
  const minimum = client ? minimums[client.platform] : undefined;
  return Boolean(client && minimum && compare(client.version, minimum) < 0);
}
export function isMutation(body: unknown) {
  const query = (body as { query?: unknown } | null)?.query;
  if (typeof query !== "string" || !/\bmutation\b/.test(query)) return false;
  try { return parse(query).definitions.some(d => d.kind === "OperationDefinition" && d.operation === "mutation"); } catch { return false; }
}
export const upgradeMessage = "Hay una versión nueva de la aplicación. Actualízala para seguir registrando cambios; mientras tanto puedes consultar.";
