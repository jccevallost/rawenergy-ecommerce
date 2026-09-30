// Último pedido hecho en este navegador (sin datos personales): su número, para
// consultarlo tras recargar, y qué productos llevaba, para avisar antes de
// registrar por error el mismo pedido otra vez desde otra pestaña o tras recargar.
const KEY = "rawenergy-last-order-v1";
export const REPEAT_WINDOW_MS = 30 * 60_000;

type Line = { productId: string; variantSku: string; quantity: number };
export const cartSignature = (items: Line[]) => items.map(item => `${item.productId}|${item.variantSku}|${item.quantity}`).sort().join(";");

type Saved = { orderNumber: string; savedAt: number; signature?: string };
function read(): Saved | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Saved> | null;
    if (typeof value?.orderNumber !== "string" || !/^RE-\d{6}-[A-Z0-9]{3,10}$/.test(value.orderNumber) || typeof value.savedAt !== "number") return null;
    return { orderNumber: value.orderNumber, savedAt: value.savedAt, signature: typeof value.signature === "string" ? value.signature : undefined };
  } catch { return null; }
}

export function rememberLastOrder(orderNumber: string, items: Line[] = []) {
  try { localStorage.setItem(KEY, JSON.stringify({ orderNumber, savedAt: Date.now(), signature: cartSignature(items) })); } catch { /* almacenamiento bloqueado */ }
}

export function readLastOrder(): string | null { return read()?.orderNumber ?? null; }

/** Número del pedido con exactamente estos productos registrado hace menos de 30 minutos. */
export function recentSameOrder(items: Line[], now = Date.now()): string | null {
  const saved = read();
  if (!saved?.signature || !items.length || now - saved.savedAt > REPEAT_WINDOW_MS || now < saved.savedAt) return null;
  return saved.signature === cartSignature(items) ? saved.orderNumber : null;
}
