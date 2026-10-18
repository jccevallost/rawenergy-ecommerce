// M05: conciliación de la factura de una compra con decimales exactos.
//
// Por decisión del propietario (14/10/2026) los precios de venta incluyen IVA y el margen se mide
// con IVA, así que el costo unitario de inventario es el costo con IVA: (total neto de la línea +
// IVA asignado) / cantidad. Se conservan también el unitario neto de seis decimales, el total neto
// impreso, la tarifa y el IVA asignado. El total de la compra es el total impreso de la factura.
// Las diferencias no se corrigen: se rechazan con un mensaje que dice qué revisar.
import { allocateCents, formatDecimal, parseDecimal, percentOf, roundTo, sum, toCents, toNumber, type Micros } from "../lib/money.js";
import { parseAccessKey } from "../lib/ecuadorInvoice.js";

export const taxRates = [0, 5, 15] as const;
export type TaxRate = typeof taxRates[number];
export type InvoiceDocument = { type: "FACTURA"; supplierTaxId: string; number: string; issuedOn: string; accessKey: string; subtotal: string | number; tax: string | number; total: string | number };
export type InvoiceLine = { quantity: number; netUnitCost: string | number; netTotal: string | number; taxRate?: TaxRate };
export type DerivedLine = { netUnitCost: string; netTotal: string; taxRate: TaxRate; taxAllocated: string; costWithTax: string; unitCost: number };
export type DerivedDocument = { document: Omit<InvoiceDocument, "subtotal" | "tax" | "total"> & { subtotal: string; tax: string; total: string; taxMethod: "GLOBAL" | "PER_LINE" }; documentKey: string; lines: DerivedLine[]; total: number; calculatedTotal: number };

const roundDiv = (a: Micros, b: bigint) => (a * 2n + b) / (2n * b);
const money = (value: string | number, decimals: number, label: string) => {
  try { return parseDecimal(value, decimals); } catch { throw new Error(`${label}: «${String(value).slice(0, 20)}» no es un importe válido. Usa hasta ${decimals} decimales.`); }
};

export function documentKeyOf(document: Pick<InvoiceDocument, "supplierTaxId" | "type" | "number">) { return `${document.supplierTaxId}:${document.type}:${document.number}`; }

export function reconcileInvoice(document: InvoiceDocument, lines: InvoiceLine[]): DerivedDocument {
  if (document.accessKey) {
    const key = parseAccessKey(document.accessKey);
    if (typeof key === "string") throw new Error(key);
    const [establishment, point, sequential] = document.number.split("-");
    if (key.documentType !== "01") throw new Error("La clave de acceso no corresponde a una factura (tipo 01).");
    if (key.issuedOn !== document.issuedOn) throw new Error(`La fecha de la clave de acceso (${key.issuedOn}) no coincide con la fecha de emisión (${document.issuedOn}).`);
    if (key.taxId !== document.supplierTaxId) throw new Error(`El RUC de la clave de acceso (${key.taxId}) no coincide con el RUC del proveedor (${document.supplierTaxId}).`);
    if (key.series !== `${establishment}${point}` || key.sequential !== sequential) throw new Error(`El número de factura no coincide con la clave de acceso (${key.series.slice(0, 3)}-${key.series.slice(3)}-${key.sequential}).`);
  }
  const parsed = lines.map((line, i) => {
    const label = `Línea ${i + 1}`;
    const unit = money(line.netUnitCost, 6, `${label}, unitario sin IVA`), total = money(line.netTotal, 2, `${label}, total sin IVA`);
    const rate = line.taxRate ?? 15;
    if (!taxRates.includes(rate)) throw new Error(`${label}: tarifa de IVA no admitida.`);
    const expected = BigInt(line.quantity) * unit;
    if (toCents(expected) !== total) throw new Error(`${label}: ${line.quantity} × ${formatDecimal(unit, 6)} = ${formatDecimal(expected, 6)}, pero el total de la línea es ${formatDecimal(total)}. Revisa la cantidad, el unitario o el total.`);
    return { unit, total, rate, quantity: BigInt(line.quantity) };
  });
  const subtotal = money(document.subtotal, 2, "Subtotal de la factura"), tax = money(document.tax, 2, "IVA de la factura"), total = money(document.total, 2, "Total de la factura");
  const linesSubtotal = sum(parsed.map(l => l.total));
  if (linesSubtotal !== subtotal) throw new Error(`La suma de las líneas (${formatDecimal(linesSubtotal)}) no coincide con el subtotal de la factura (${formatDecimal(subtotal)}).`);
  // El IVA impreso puede calcularse sobre la base de cada tarifa o línea por línea; se acepta el que coincida.
  const groups = taxRates.map(rate => ({ rate, indexes: parsed.flatMap((l, i) => l.rate === rate ? [i] : []) })).filter(g => g.indexes.length);
  const globalTax = sum(groups.map(g => toCents(percentOf(sum(g.indexes.map(i => parsed[i]!.total)), g.rate))));
  const perLineTax = sum(parsed.map(l => toCents(percentOf(l.total, l.rate))));
  const taxMethod = tax === globalTax ? "GLOBAL" : tax === perLineTax ? "PER_LINE" : null;
  if (!taxMethod) throw new Error(`El IVA de la factura (${formatDecimal(tax)}) no coincide con el calculado sobre las bases (${formatDecimal(globalTax)}) ni línea por línea (${formatDecimal(perLineTax)}). Revisa las tarifas de cada línea.`);
  if (subtotal + tax !== total) throw new Error(`Subtotal + IVA (${formatDecimal(subtotal + tax)}) no coincide con el total de la factura (${formatDecimal(total)}). Descuentos, ICE u otros cargos aún no se admiten.`);
  const allocated: Micros[] = parsed.map(() => 0n);
  if (taxMethod === "PER_LINE") parsed.forEach((l, i) => { allocated[i] = toCents(percentOf(l.total, l.rate)); });
  else for (const g of groups) {
    const groupTax = toCents(percentOf(sum(g.indexes.map(i => parsed[i]!.total)), g.rate));
    allocateCents(groupTax, g.indexes.map(i => parsed[i]!.total)).forEach((cents, j) => { allocated[g.indexes[j]!] = cents; });
  }
  const derived = parsed.map((l, i) => {
    const costWithTax = l.total + allocated[i]!;
    return { netUnitCost: formatDecimal(l.unit, 6), netTotal: formatDecimal(l.total), taxRate: l.rate as TaxRate, taxAllocated: formatDecimal(allocated[i]!), costWithTax: formatDecimal(costWithTax), unitCost: toNumber(roundTo(roundDiv(costWithTax, l.quantity), 6)) };
  });
  const calculated = sum(parsed.map((l, i) => l.total + allocated[i]!));
  return {
    document: { type: document.type, supplierTaxId: document.supplierTaxId, number: document.number, issuedOn: document.issuedOn, accessKey: document.accessKey, subtotal: formatDecimal(subtotal), tax: formatDecimal(tax), total: formatDecimal(total), taxMethod },
    documentKey: documentKeyOf(document), lines: derived, total: toNumber(total, 2), calculatedTotal: toNumber(calculated, 2)
  };
}

/** Total sin factura: cantidad × costo con decimales exactos, redondeado a centavos. */
export function legacyTotal<T extends { quantity: number; unitCost: number }>(items: T[]) {
  return toNumber(toCents(sum(items.map((item, i) => BigInt(item.quantity) * money(item.unitCost, 6, `Línea ${i + 1}, costo unitario`)))), 2);
}
