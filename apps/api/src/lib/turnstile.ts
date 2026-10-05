import { GraphQLError } from "graphql";
import { env } from "../config/env.js";

// CAPTCHA con Cloudflare Turnstile (C70, S03 y S04): se exige en el registro y en los pedidos
// nuevos solo si están TURNSTILE_SECRET_KEY y TURNSTILE_SITE_KEY. Sin ellas no cambia nada.
// Turnstile casi nunca muestra un desafío: comprueba el navegador en segundo plano.
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const turnstileEnabled = () => Boolean(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY);

/**
 * Verifica el token del navegador. Token ausente o rechazado por Cloudflare → CAPTCHA_FAILED.
 * Si Cloudflare no responde, no se bloquea la compra: se deja pasar y se registra (los
 * límites por conexión y por persona siguen aplicando).
 */
export async function verifyHuman(token: string | null | undefined, ip?: string, fetcher: typeof fetch = fetch) {
  if (!turnstileEnabled()) return;
  const failed = () => new GraphQLError("No pudimos comprobar que la solicitud la hace una persona. Vuelve a intentarlo.", { extensions: { code: "CAPTCHA_FAILED" } });
  if (!token || token.length > 2048) throw failed();
  let result: { success?: boolean; "error-codes"?: string[] };
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token, ...(ip ? { remoteip: ip } : {}) });
    const response = await fetcher(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    result = await response.json() as typeof result;
  } catch (error) {
    console.error("[turnstile] Cloudflare no respondió; la solicitud sigue sin verificar", error);
    return;
  }
  if (!result.success) throw failed();
}
