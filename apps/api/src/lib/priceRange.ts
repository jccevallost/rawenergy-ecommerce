// Rango de precio que ve el cliente en tarjetas, filtro y orden: solo
// presentaciones con existencias. Si todo está agotado se usa el de todas;
// la tienda igual muestra «Agotado».
export function sellablePriceRange(variants: ReadonlyArray<{ price: number; stock: number }>) {
  const sellable = variants.filter(variant => variant.stock > 0);
  const prices = (sellable.length ? sellable : variants).map(variant => variant.price);
  return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : { min: 0, max: 0 };
}
