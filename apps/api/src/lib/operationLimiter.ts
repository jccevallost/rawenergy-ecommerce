import { GraphQLError } from "graphql";

// El limitador HTTP global cuenta peticiones, no operaciones: una sola peticion
// puede traer muchas mutaciones. Estos limites se aplican a cada operacion
// sensible, por IP y, en el acceso, por cuenta.
//
// Viven en la memoria de cada instancia. Con varias instancias detras de un
// balanceador cada una cuenta por separado; para eso hace falta un almacen
// compartido (pendiente en el registro de auditoria).
export type LimitRule = { limit: number; windowMs: number; message: string };

export const operationRules = {
  login: { limit: 10, windowMs: 15 * 60_000, message: "Demasiados intentos de acceso desde esta conexión." },
  loginFailures: { limit: 8, windowMs: 15 * 60_000, message: "Demasiados intentos fallidos para esta cuenta." },
  register: { limit: 5, windowMs: 60 * 60_000, message: "Demasiados registros desde esta conexión." },
  passwordReset: { limit: 5, windowMs: 15 * 60_000, message: "Demasiadas solicitudes de recuperación desde esta conexión." },
  checkout: { limit: 12, windowMs: 10 * 60_000, message: "Demasiados pedidos seguidos desde esta conexión." },
  cartTotals: { limit: 90, windowMs: 60_000, message: "Demasiadas consultas de total seguidas." },
  orderLookup: { limit: 20, windowMs: 15 * 60_000, message: "Demasiadas consultas de pedidos desde esta conexión." },
  emailCheck: { limit: 30, windowMs: 60_000, message: "Demasiadas comprobaciones de correo seguidas." }
} satisfies Record<string, LimitRule>;

export type OperationName = keyof typeof operationRules;

const SWEEP_EVERY = 500;

export function createOperationLimiter(rules: Record<OperationName, LimitRule> = operationRules, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  let calls = 0;
  const maxWindow = Math.max(...Object.values(rules).map(rule => rule.windowMs));

  const recent = (name: OperationName, key: string) => {
    const bucket = `${name}:${key}`;
    const threshold = now() - rules[name].windowMs;
    const kept = (hits.get(bucket) ?? []).filter(time => time > threshold);
    if (kept.length) hits.set(bucket, kept); else hits.delete(bucket);
    return { bucket, kept };
  };

  const sweep = () => {
    if (++calls % SWEEP_EVERY) return;
    const threshold = now() - maxWindow;
    for (const [bucket, times] of hits) if ((times.at(-1) ?? 0) <= threshold) hits.delete(bucket);
  };

  /** Rechaza si la clave ya agotó su cupo, sin contar este intento. */
  const assert = (name: OperationName, key: string) => {
    const { kept } = recent(name, key);
    const rule = rules[name];
    if (kept.length < rule.limit) return;
    const retryAfter = Math.max(1, Math.ceil((kept[0]! + rule.windowMs - now()) / 1000));
    const minutes = Math.ceil(retryAfter / 60);
    throw new GraphQLError(`${rule.message} Espera ${minutes === 1 ? "1 minuto" : `${minutes} minutos`} y vuelve a intentarlo.`, {
      extensions: { code: "RATE_LIMITED", retryAfter }
    });
  };

  const hit = (name: OperationName, key: string) => {
    sweep();
    const { bucket, kept } = recent(name, key);
    hits.set(bucket, [...kept, now()]);
  };

  return {
    assert,
    hit,
    /** Comprueba y cuenta el intento. */
    consume(name: OperationName, key: string) { assert(name, key); hit(name, key); },
    reset(name: OperationName, key: string) { hits.delete(`${name}:${key}`); },
    size: () => hits.size
  };
}

export const operationLimiter = createOperationLimiter();

export const clientKey = (ip?: string) => ip || "sin-ip";
