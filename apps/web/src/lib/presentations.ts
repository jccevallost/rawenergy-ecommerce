import type { Product } from "@vital-forge/shared-logic";

// Resumen de presentaciones para tarjetas y carriles (C47). «3 presentaciones»
// mezclaba sabores y tamaños: se dice cuáles tamaños hay y cuántos sabores.
type Variant = Product["variants"][number];
const sizeOf = (variant: Variant) => ({ value: variant.size?.value ?? variant.sizeValue ?? 0, unit: variant.size?.unit ?? variant.sizeUnit ?? "" });
const unitOrder = ["g", "kg", "lb", "porciones", "medidas"];
export const sizeLabel = (variant: Variant) => { const { value, unit } = sizeOf(variant); return value ? `${String(value).replace(".", ",")} ${unit}`.trim() : unit; };

const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
/**
 * «Sabor · tamaño» de una presentación, con coma decimal (1,6 lb) como en el resto de la
 * tienda (C63). Si el sabor solo repite el formato («Cápsulas» en «60 cápsulas»), no se repite.
 */
export function presentationLabel(variant: Variant) {
  const size = sizeLabel(variant);
  const flavor = variant.flavor?.trim() ?? "";
  if (!flavor || (size && plain(size).includes(plain(flavor)))) return size;
  return [flavor, size].filter(Boolean).join(" · ");
}

/** Pocas unidades: a partir de aquí la tarjeta y la ficha dicen cuántas quedan (C63; antes 8 en tarjetas y 5 en la ficha). */
export const LOW_STOCK = 5;

export function presentationSummary(product: Pick<Product, "variants">) {
  const sizes = [...new Map(product.variants.map(v => [sizeLabel(v), sizeOf(v)])).entries()]
    .sort(([, a], [, b]) => (unitOrder.indexOf(a.unit) - unitOrder.indexOf(b.unit)) || (a.unit === "kg" ? a.value * 1000 : a.value) - (b.unit === "kg" ? b.value * 1000 : b.value))
    .map(([label]) => label).filter(Boolean);
  const flavors = new Set(product.variants.map(v => v.flavor).filter(Boolean)).size;
  const parts = [sizes.length > 3 ? `${sizes.length} tamaños` : sizes.join(" · "), flavors > 1 ? `${flavors} sabores` : ""].filter(Boolean);
  return { sizes, flavors, text: parts.join(" · ") };
}
