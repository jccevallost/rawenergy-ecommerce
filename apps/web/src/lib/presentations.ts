import type { Product } from "@vital-forge/shared-logic";

// Resumen de presentaciones para tarjetas y carriles (C47). «3 presentaciones»
// mezclaba sabores y tamaños: se dice cuáles tamaños hay y cuántos sabores.
type Variant = Product["variants"][number];
const sizeOf = (variant: Variant) => ({ value: variant.size?.value ?? variant.sizeValue ?? 0, unit: variant.size?.unit ?? variant.sizeUnit ?? "" });
const unitOrder = ["g", "kg", "lb", "porciones", "medidas"];
export const sizeLabel = (variant: Variant) => { const { value, unit } = sizeOf(variant); return value ? `${String(value).replace(".", ",")} ${unit}`.trim() : unit; };

export function presentationSummary(product: Pick<Product, "variants">) {
  const sizes = [...new Map(product.variants.map(v => [sizeLabel(v), sizeOf(v)])).entries()]
    .sort(([, a], [, b]) => (unitOrder.indexOf(a.unit) - unitOrder.indexOf(b.unit)) || (a.unit === "kg" ? a.value * 1000 : a.value) - (b.unit === "kg" ? b.value * 1000 : b.value))
    .map(([label]) => label).filter(Boolean);
  const flavors = new Set(product.variants.map(v => v.flavor).filter(Boolean)).size;
  const parts = [sizes.length > 3 ? `${sizes.length} tamaños` : sizes.join(" · "), flavors > 1 ? `${flavors} sabores` : ""].filter(Boolean);
  return { sizes, flavors, text: parts.join(" · ") };
}

/** Tamaño de la presentación más barata con existencias: acompaña al «Desde». */
export function cheapestSize(product: Pick<Product, "variants" | "priceRange">) {
  const cheapest = product.variants.find(v => v.stock > 0 && v.price === product.priceRange.min) ?? product.variants.find(v => v.price === product.priceRange.min);
  return cheapest ? sizeLabel(cheapest) : "";
}
