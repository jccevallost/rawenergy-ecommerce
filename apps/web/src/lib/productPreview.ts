import type { Product } from "@vital-forge/shared-logic";

// Producto ya cargado en una tarjeta: la ficha lo muestra al instante mientras la
// API confirma los datos vigentes (precio, stock), en lugar de una pantalla vacía.
const previews = new Map<string, Product>();

export const keepPreview = (product: Product) => { previews.set(product.slug, product); };
export const previewFor = (slug: string) => previews.get(slug);

/**
 * Marca la foto de la tarjeta para que la transición de vista la «vuele» hasta la
 * ficha. El nombre se retira después: dos elementos con el mismo nombre anulan
 * la transición.
 */
export function flyPhoto(from: Element | null) {
  const photo = from?.querySelector<HTMLElement>("img, .photo-fallback");
  if (!photo) return;
  photo.style.viewTransitionName = "product-photo";
  window.setTimeout(() => { photo.style.viewTransitionName = ""; }, 700);
}
