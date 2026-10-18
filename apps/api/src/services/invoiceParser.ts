// IMP-01 (M11): lectura de facturas electrónicas con plantilla PERSEO/WinDev (FITLAB, 13/10/2026) a partir
// del texto posicionado del PDF. Las columnas se identifican por la posición de sus encabezados, no por saltos
// de línea, porque el orden del texto extraído no coincide con el visual. Nada se corrige ni se inventa: lo que
// no se puede leer o no cuadra se devuelve como excepción para revisión.
import { formatDecimal, parseDecimal } from "../lib/money.js";

export type TextItem = { x: number; y: number; str: string };
export type ParsedLine = { index: number; code: string; description: string; unit: string; quantity: number; netUnitCost: string; netTotal: string; discountPercent: number };
export type InvoiceException = { code: string; message: string; line?: number };
export type ParsedInvoice = {
  template: "PERSEO_FACTURA"; parserVersion: number;
  supplier: { taxId: string; name: string };
  document: { type: "FACTURA"; number: string; issuedOn: string; accessKey: string; subtotal: string; tax: string; total: string };
  totals: Record<string, string>;
  additional: Record<string, string>;
  lines: ParsedLine[];
  exceptions: InvoiceException[];
};
export const PARSER_VERSION = 1;

const near = (a: number, b: number, tolerance = 4) => Math.abs(a - b) <= tolerance;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
/** Importe impreso con coma o punto decimal y sin separador de miles. */
const amount = (text: string, decimals: number) => formatDecimal(parseDecimal(text.trim().replace(",", "."), decimals), decimals);

export function parsePerseoInvoice(raw: TextItem[]): ParsedInvoice | { error: string } {
  const items = raw.map(i => ({ ...i, str: clean(i.str) })).filter(i => i.str);
  const find = (re: RegExp) => items.find(i => re.test(i.str));
  const rightOf = (label: TextItem | undefined, re: RegExp) => label ? items.filter(i => i !== label && near(i.y, label.y) && i.x > label.x && re.test(i.str)).sort((a, b) => a.x - b.x)[0] : undefined;
  const numberLabel = find(/^FACTURA N\.?$/i), header = find(/^Código$/i);
  if (!numberLabel || !header) return { error: "Formato de factura no reconocido. Registra la compra a mano o usa el XML del comprobante." };
  const exceptions: InvoiceException[] = [];
  const rucLabel = find(/^RUC\.?:$/i);
  const taxId = rightOf(rucLabel, /^\d{13}$/)?.str ?? "";
  const number = rightOf(numberLabel, /^\d{3}-\d{3}-\d{9}$/)?.str ?? "";
  const keyLabel = find(/^CLAVE DE ACCESO:?$/i);
  const accessKey = keyLabel ? (items.filter(i => /^\d{49}$/.test(i.str) && i.y < keyLabel.y).sort((a, b) => b.y - a.y)[0]?.str ?? "") : "";
  const issuedLabel = find(/^Fecha Emisi[oó]n:?$/i);
  const issuedRaw = rightOf(issuedLabel, /^\d{2}\/\d{2}\/\d{4}$/)?.str ?? "";
  const issuedOn = issuedRaw ? `${issuedRaw.slice(6, 10)}-${issuedRaw.slice(3, 5)}-${issuedRaw.slice(0, 2)}` : "";
  const addressLabel = find(/^Direcci[oó]n Matriz:/i);
  const name = addressLabel ? items.filter(i => i.y > addressLabel.y && i.y - addressLabel.y < 20 && i.x < 300).sort((a, b) => a.y - b.y)[0]?.str ?? "" : "";
  if (!taxId) exceptions.push({ code: "SIN_RUC", message: "No se pudo leer el RUC del emisor." });
  if (!number) exceptions.push({ code: "SIN_NUMERO", message: "No se pudo leer el número de factura." });
  if (!issuedOn) exceptions.push({ code: "SIN_FECHA", message: "No se pudo leer la fecha de emisión." });

  // Columnas: el código es el texto más a la izquierda, la descripción va hasta la columna «Med.», y cada
  // número de la derecha se asigna al encabezado más cercano (los encabezados están centrados y los
  // números alineados a la derecha, así que no se usan como límites exactos).
  const col = (re: RegExp) => items.find(i => near(i.y, header.y, 8) && re.test(i.str))?.x;
  const xUnit = col(/^Med\.?$/i) ?? 340;
  const numericColumns = ([["quantity", col(/^Cantidad$/i)], ["price", col(/^(Precio|Unitario)$/i)], ["discount", col(/^Dto\.?$/i)], ["total", col(/^Total$/i)]] as const).filter((c): c is readonly [typeof c[0], number] => typeof c[1] === "number");
  if (numericColumns.length < 4) return { error: "Formato de factura no reconocido: faltan columnas de cantidad, precio, descuento o total." };
  const tableEnd = Math.max(...items.filter(i => /^(Forma Pago|Subtotal:?)$/i.test(i.str)).map(i => i.y), 0);
  const body = items.filter(i => i.y < header.y - 8 && i.y > tableEnd + 4 && i.str !== "*");
  const rows: TextItem[][] = [];
  for (const item of [...body].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find(r => near(r[0]!.y, item.y, 2));
    if (row) row.push(item); else rows.push([item]);
  }
  const lines: ParsedLine[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    const first = row[0]!;
    const hasCode = first.x < xUnit / 4;
    const unitItem = row.find(i => near(i.x, xUnit, 25) && !/^\d/.test(i.str));
    const description = row.filter(i => (!hasCode || i !== first) && i.x < (unitItem?.x ?? xUnit) - 10).map(i => i.str).join(" ");
    if (!hasCode) { if (description && lines.length) lines.at(-1)!.description = clean(`${lines.at(-1)!.description} ${description}`); continue; }
    const values: Record<string, string> = {};
    for (const item of row.filter(i => i.x > (unitItem?.x ?? xUnit) + 20)) {
      const [key] = [...numericColumns].sort((a, b) => Math.abs(a[1] - item.x) - Math.abs(b[1] - item.x))[0]!;
      values[key] = values[key] ? `${values[key]} ${item.str}` : item.str;
    }
    const code = first.str, index = lines.length;
    try {
      const quantity = Number(amount(values.quantity ?? "", 6));
      if (!Number.isInteger(quantity) || quantity <= 0) exceptions.push({ code: "CANTIDAD_FRACCION", message: `Línea ${index + 1}: la cantidad ${values.quantity} no es un número entero de unidades.`, line: index });
      const discountPercent = Number(((values.discount ?? "0").match(/[\d.,]+/)?.[0] ?? "0").replace(",", "."));
      if (discountPercent) exceptions.push({ code: "DESCUENTO_LINEA", message: `Línea ${index + 1}: tiene ${discountPercent}% de descuento; aún no se admite en la importación.`, line: index });
      lines.push({ index, code, description: clean(description), unit: clean(unitItem?.str ?? ""), quantity, netUnitCost: amount(values.price ?? "", 6), netTotal: amount(values.total ?? "", 2), discountPercent });
    } catch {
      exceptions.push({ code: "LINEA_ILEGIBLE", message: `Línea ${index + 1} (${code}): no se pudieron leer cantidad, unitario o total.`, line: index });
    }
  }
  if (!lines.length) exceptions.push({ code: "SIN_LINEAS", message: "No se encontraron líneas de productos." });

  // Bloque de totales: etiqueta a la izquierda e importe a la derecha en la misma fila.
  const totals: Record<string, string> = {};
  const labels: Array<[string, RegExp]> = [["subtotal", /^Subtotal:$/i], ["discount", /^Descuento:$/i], ["netSubtotal", /^Subtotal Neto:$/i], ["base15", /^Subtotal 15 ?%:?$/i], ["base5", /^Subtotal 5 ?%:?$/i], ["base0", /^Subtotal 0 ?%:?$/i], ["notSubject", /^Subtotal No Objeto IVA:?$/i], ["exempt", /^Subtotal Exento IVA ?:?$/i], ["ice", /^ICE:$/i], ["iva5", /^IVA 5 ?%:?$/i], ["iva15", /^IVA 15 ?%:?$/i], ["tip", /^Propina:$/i], ["total", /^VALOR TOTAL$/i]];
  for (const [key, re] of labels) {
    const label = find(re); if (!label) continue;
    const value = items.filter(i => i.x > label.x + 60 && near(i.y, label.y) && /^\d+([.,]\d+)?$/.test(i.str)).sort((a, b) => a.x - b.x)[0];
    if (value) totals[key] = amount(value.str, 2);
  }
  for (const [key, label] of [["discount", "descuento global"], ["base5", "base con IVA 5%"], ["base0", "base con IVA 0%"], ["notSubject", "base no objeto de IVA"], ["exempt", "base exenta"], ["ice", "ICE"], ["iva5", "IVA 5%"], ["tip", "propina"]] as const) {
    if (totals[key] && totals[key] !== "0.00") exceptions.push({ code: "VALOR_NO_ADMITIDO", message: `La factura tiene ${label} de ${totals[key]}; la importación solo admite por ahora todas las líneas con IVA 15% sin descuentos ni cargos.` });
  }
  for (const key of ["base15", "iva15", "total"]) if (!totals[key]) exceptions.push({ code: "SIN_TOTALES", message: `No se pudo leer ${key === "base15" ? "la base con IVA 15%" : key === "iva15" ? "el IVA 15%" : "el valor total"}.` });
  const additional: Record<string, string> = {};
  const otherRuc = find(/^RUC Proveedor:/i);
  if (otherRuc) additional.rucProveedor = otherRuc.str.replace(/^RUC Proveedor:\s*/i, "");
  return {
    template: "PERSEO_FACTURA", parserVersion: PARSER_VERSION, supplier: { taxId, name },
    document: { type: "FACTURA", number, issuedOn, accessKey, subtotal: totals.base15 ?? "", tax: totals.iva15 ?? "", total: totals.total ?? "" },
    totals, additional, lines, exceptions
  };
}
