import { promises as dns } from "node:dns";
import { env } from "../config/env.js";

// Comprueba que el dominio del correo exista y reciba correo (registros MX, o
// A/AAAA como respaldo según RFC 5321). Un dominio inexistente o con «MX nulo»
// (RFC 7505, p. ej. example.com) se rechaza. Si el DNS no responde —sin red,
// tiempo agotado— no se bloquea la compra: el formato ya se validó.
const TIMEOUT_MS = 2500;
const cache = new Map<string, { accepts: boolean; until: number }>();

const withTimeout = <T>(work: Promise<T>) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), TIMEOUT_MS).unref())]);
const codeOf = (error: unknown) => (error as { code?: string }).code;

async function hasAddress(domain: string) {
  for (const family of ["resolve4", "resolve6"] as const) {
    try { if ((await withTimeout(dns[family](domain))).length) return true; }
    catch (error) { if (!["ENOTFOUND", "ENODATA"].includes(codeOf(error) ?? "")) return true; }
  }
  return false;
}

async function acceptsMail(domain: string): Promise<boolean> {
  try {
    const records = await withTimeout(dns.resolveMx(domain));
    if (records.length && records.every(record => record.exchange === "" || record.exchange === ".")) return false;
    return records.length > 0 || await hasAddress(domain);
  } catch (error) {
    const code = codeOf(error);
    if (code === "ENOTFOUND") return false;
    if (code === "ENODATA") return hasAddress(domain);
    return true;
  }
}

export const emailDomainService = {
  /** Mensaje para el cliente si el dominio no recibe correo; null si sí o si no se pudo comprobar. */
  async problem(email: string): Promise<string | null> {
    if (env.emailDomainCheck === "off") return null;
    const domain = email.trim().toLowerCase().split("@")[1];
    if (!domain) return null;
    const cached = cache.get(domain);
    let accepts = cached && cached.until > Date.now() ? cached.accepts : undefined;
    if (accepts === undefined) {
      accepts = await acceptsMail(domain);
      if (cache.size > 5000) cache.clear();
      cache.set(domain, { accepts, until: Date.now() + (accepts ? 6 * 3600_000 : 10 * 60_000) });
    }
    return accepts ? null : `El dominio «${domain}» no recibe correos. Revisa que esté bien escrito.`;
  }
};
