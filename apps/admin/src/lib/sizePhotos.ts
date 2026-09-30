import type { VariantDraft } from "@vital-forge/shared-logic";

// Fotos por tamaño (C48). El envase cambia con el tamaño y el sabor suele cambiar
// solo la etiqueta: una foto subida a «2 lb» se guarda en todas las presentaciones
// de 2 lb. Los datos siguen por presentación (sin migración ni cambios en la API):
// la galería del tamaño muestra las fotos que comparten todos sus sabores.
export const MAX_PHOTOS = 8;
type Photo = VariantDraft["images"][number];
export type SizeGroup = { key: string; indexes: number[]; flavors: string[]; common: Photo[]; free: number };

export const sizeKey = (variant: Pick<VariantDraft, "size">) => `${variant.size.value} ${variant.size.unit}`.trim();
/** Texto alternativo útil por omisión (no el SKU): producto, sabor y tamaño. */
export const photoAlt = (title: string, variant: Pick<VariantDraft, "flavor" | "size">) => [title.trim(), variant.flavor, sizeKey(variant)].filter(Boolean).join(", ").slice(0, 140);
export const sizeAlt = (title: string, key: string) => [title.trim(), key].filter(Boolean).join(", ").slice(0, 140);

export function sizeGroups(variants: VariantDraft[]): SizeGroup[] {
  const byKey = new Map<string, number[]>();
  variants.forEach((variant, index) => byKey.set(sizeKey(variant), [...(byKey.get(sizeKey(variant)) ?? []), index]));
  return [...byKey.entries()].map(([key, indexes]) => {
    const members = indexes.map(index => variants[index]!);
    const common = members[0]!.images.filter(photo => members.every(member => member.images.some(other => other.url === photo.url)));
    return { key, indexes, flavors: members.map(member => member.flavor), common, free: Math.min(...members.map(member => MAX_PHOTOS - member.images.length)) };
  });
}

const inGroup = (variants: VariantDraft[], key: string, change: (variant: VariantDraft) => VariantDraft) =>
  variants.map(variant => sizeKey(variant) === key ? change(variant) : variant);

/** Agrega la foto a cada presentación del tamaño que no la tenga y tenga lugar. */
export function addToSize(variants: VariantDraft[], key: string, photo: Photo) {
  let added = 0, full = 0;
  const next = inGroup(variants, key, variant => {
    if (variant.images.some(image => image.url === photo.url)) return variant;
    if (variant.images.length >= MAX_PHOTOS) { full++; return variant; }
    added++;
    return { ...variant, images: [...variant.images, { ...photo }] };
  });
  return { next, added, full };
}

export const removeFromSize = (variants: VariantDraft[], key: string, url: string) =>
  inGroup(variants, key, variant => ({ ...variant, images: variant.images.filter(image => image.url !== url) }));

export const coverOfSize = (variants: VariantDraft[], key: string, url: string) =>
  inGroup(variants, key, variant => {
    const photo = variant.images.find(image => image.url === url);
    return photo ? { ...variant, images: [photo, ...variant.images.filter(image => image.url !== url)] } : variant;
  });

export const altInSize = (variants: VariantDraft[], key: string, url: string, alt: string) =>
  inGroup(variants, key, variant => ({ ...variant, images: variant.images.map(image => image.url === url ? { ...image, alt } : image) }));
