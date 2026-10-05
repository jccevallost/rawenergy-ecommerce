// Marca parecida a una existente (C66, V20): «Dargon Pharma» frente a «Dragon Pharma».
const plainText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) { let previous = row[0]!; row[0] = i; for (let j = 1; j <= b.length; j++) { const current = row[j]!; row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = current; } }
  return row[b.length]!;
}
/** Marca existente parecida a la escrita, o null si coincide o no se parece a ninguna. */
export function similarBrand(brand: string, existing: string[]) {
  const typed = plainText(brand);
  if (typed.length < 3 || existing.some((name) => plainText(name) === typed)) return null;
  return existing.find((name) => { const known = plainText(name); return known.startsWith(typed) || typed.startsWith(known) || distance(known, typed) <= 2; }) ?? null;
}
