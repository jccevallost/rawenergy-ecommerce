import { isIP } from "node:net";
import { env } from "../config/env.js";

type RequestLike = { ip?: string; headers: Record<string, string | string[] | undefined> };

// La IP que cuenta para los límites y la auditoría (C60, S02). Detrás de Cloudflare y
// Render, `req.ip` con `trust proxy` puede ser la IP de un proxy que comparten muchos
// visitantes. Si CLIENT_IP_HEADER está definida, se usa esa cabecera, que el proxy de
// confianza sobrescribe en cada petición; si falta o no es una IP, se vuelve a req.ip.
export function clientIp(req: RequestLike): string {
  const header = env.CLIENT_IP_HEADER?.toLowerCase();
  if (header) {
    const raw = req.headers[header];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.split(",")[0]?.trim();
    if (value && isIP(value)) return value;
  }
  return req.ip ?? "";
}

/** Expande una IPv6 abreviada a sus ocho grupos. */
function ipv6Groups(address: string): string[] | null {
  const [head = "", tail] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? left.length !== 8 : missing < 0) return null;
  return [...left, ...Array(tail === undefined ? 0 : missing).fill("0"), ...right].map(group => group.toLowerCase().padStart(4, "0"));
}

/**
 * Clave del limitador para una IP. IPv4 se usa tal cual (también la IPv4 dentro de
 * «::ffff:»). IPv6 se agrupa por su prefijo /64: un mismo cliente suele tener un /64
 * entero y, sin agrupar, cambiar de dirección dentro de él renovaría el cupo.
 */
export function ipKey(ip?: string): string {
  if (!ip) return "sin-ip";
  const value = ip.replace(/^::ffff:/i, "").replace(/%.*$/, "");
  if (isIP(value) !== 6 || value.includes(".")) return value;
  const groups = ipv6Groups(value);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : value;
}
