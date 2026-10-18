// M05: aritmética decimal exacta para compras. Los importes se manejan como enteros en
// millonésimas (BigInt) y se redondean de forma explícita, mitad hacia arriba, como en las
// facturas. Nunca se ajusta un importe para forzar una conciliación: las diferencias se informan.
const SCALE = 6n, UNIT = 10n ** SCALE, CENT = 10n ** (SCALE - 2n);
export type Micros = bigint;

/** Acepta "21.756521", "87,03" o un número; máximo 9 enteros y `maxDecimals` decimales. */
export function parseDecimal(value: string | number, maxDecimals = 6): Micros {
  const text = typeof value === "number" ? (Number.isFinite(value) ? value.toString() : "") : value.trim().replace(",", ".");
  const match = /^(\d{1,9})(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2]?.length ?? 0) > maxDecimals) throw new Error(`Importe no válido: «${String(value).slice(0, 20)}». Usa hasta ${maxDecimals} decimales.`);
  return BigInt(match[1]!) * UNIT + BigInt((match[2] ?? "").padEnd(Number(SCALE), "0"));
}
/** Redondeo mitad hacia arriba a `decimals` decimales (importes positivos). */
export function roundTo(value: Micros, decimals: number): Micros {
  const step = 10n ** (SCALE - BigInt(decimals));
  return ((value + step / 2n) / step) * step;
}
export const toCents = (value: Micros) => roundTo(value, 2);
export const percentOf = (base: Micros, rate: number) => (base * BigInt(rate)) / 100n;
export function formatDecimal(value: Micros, decimals = 2): string {
  const rounded = roundTo(value, decimals), whole = rounded / UNIT, fraction = (rounded % UNIT).toString().padStart(Number(SCALE), "0").slice(0, decimals);
  return decimals ? `${whole}.${fraction}` : whole.toString();
}
export const toNumber = (value: Micros, decimals = 6) => Number(formatDecimal(value, decimals));
export const sum = (values: Micros[]) => values.reduce((total, value) => total + value, 0n);

/**
 * Reparte `total` (en centavos exactos) entre partes proporcionales a `weights` por el método de
 * mayor residuo: la suma del reparto es exactamente `total`; los empates se resuelven por orden.
 */
export function allocateCents(total: Micros, weights: Micros[]): Micros[] {
  const totalCents = total / CENT, weightSum = sum(weights);
  if (total % CENT !== 0n) throw new Error("El importe a repartir debe estar en centavos.");
  if (weightSum === 0n) return weights.map(() => 0n);
  const raw = weights.map(w => totalCents * w), floors = raw.map(r => r / weightSum);
  let left = totalCents - sum(floors);
  const order = raw.map((r, i) => ({ i, rest: r % weightSum })).sort((a, b) => (b.rest > a.rest ? 1 : b.rest < a.rest ? -1 : a.i - b.i));
  for (const { i } of order) { if (left <= 0n) break; floors[i]! += 1n; left -= 1n; }
  return floors.map(c => c * CENT);
}
