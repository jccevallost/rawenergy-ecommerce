import { useMemo } from "react";
import type { VariantDraft } from "../types";

const slugPart = (value: string) => value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
const checksum = (value: string) => {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, "0");
};
const boundedSku = (value: string) => value.length <= 80 ? value : `${value.slice(0, 72).replace(/-+$/, "")}-${checksum(value)}`;
const variantKey = (flavor: string, size: { value: number; unit: string }) => JSON.stringify([flavor, size.value, size.unit]);

export const generateVariantMatrix = (
  productSlug: string,
  flavors: string[],
  sizes: Array<{ value: number; unit: string }>,
  previous: VariantDraft[] = []
): VariantDraft[] => {
  const existingByKey = new Map(previous.map(variant => [variantKey(variant.flavor, variant.size), variant]));
  const usedSkus = new Set(previous.map(variant => variant.sku));
  const seen = new Set<string>();
  const variants: VariantDraft[] = [];
  for (const flavor of flavors) for (const size of sizes) {
    const key = variantKey(flavor, size);
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = existingByKey.get(key);
    // Generar combinaciones no debe cambiar códigos manuales o ya publicados.
    // El editor actualiza explícitamente los códigos automáticos de una ficha nueva.
    if (existing) { variants.push(existing); continue; }
    const candidate = boundedSku(`${slugPart(productSlug || "PRODUCTO") || "PRODUCTO"}-${slugPart(flavor) || "OPCION"}-${size.value}${slugPart(size.unit)}`);
    let sku = candidate;
    for (let number = 2; usedSkus.has(sku); number++) {
      const suffix = `-${number}`;
      sku = `${candidate.slice(0, 80 - suffix.length)}${suffix}`;
    }
    usedSkus.add(sku);
    variants.push({ flavor, size: { ...size }, price: 0, compareAtPrice: null, stock: 0, sku, images: [] });
  }
  return variants;
};

export const useProductMatrix = (
  productSlug: string,
  flavors: string[],
  sizes: Array<{ value: number; unit: string }>,
  previous: VariantDraft[] = []
) => useMemo(
  () => generateVariantMatrix(productSlug, flavors, sizes, previous),
  [productSlug, flavors.join("|"), sizes.map((size) => `${size.value}${size.unit}`).join("|"), previous]
);
