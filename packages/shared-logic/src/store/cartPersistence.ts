import type { CartItem } from "../types";
export const CART_STORAGE_KEY = "rawenergy-cart-v1";
export const CART_MAX_LINES = 60;
export const CART_MAX_QUANTITY = 99;
const TTL = 7 * 24 * 60 * 60 * 1000;
const validText = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
/** Solo rutas propias o http(s): descarta javascript:, data: y rutas de protocolo relativo. */
export const safeImageUrl = (value: unknown) => typeof value === "string" && value.length <= 600 && /^(https?:\/\/|\/(?!\/))[^\s]+$/i.test(value) ? value : undefined;
export const cartLineKey = (item: Pick<CartItem, "productId" | "variantSku">) => JSON.stringify([item.productId, item.variantSku]);
export function safeCartItem(value: unknown): CartItem | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!validText(v.productId, 120) || !validText(v.variantSku, 120) || !validText(v.title, 160) || !validText(v.variantLabel, 200)) return null;
  if (typeof v.quantity !== "number" || !Number.isInteger(v.quantity) || v.quantity < 1 || v.quantity > CART_MAX_QUANTITY) return null;
  if (typeof v.unitPrice !== "number" || !Number.isFinite(v.unitPrice) || v.unitPrice < 0 || v.unitPrice > 1000000) return null;
  if (typeof v.vitalCoinsReward !== "number" || !Number.isInteger(v.vitalCoinsReward) || v.vitalCoinsReward < 0 || v.vitalCoinsReward > 1000000) return null;
  const image = safeImageUrl(v.image);
  const maxQuantity = typeof v.maxQuantity === "number" && Number.isInteger(v.maxQuantity) && v.maxQuantity >= 1 && v.maxQuantity <= 1000000 ? v.maxQuantity : undefined;
  return { productId: v.productId, variantSku: v.variantSku, title: v.title, variantLabel: v.variantLabel, unitPrice: v.unitPrice, quantity: v.quantity, vitalCoinsReward: v.vitalCoinsReward, image, ...(maxQuantity ? { maxQuantity } : {}) };
}
/** Productos guardados válidos, o null si no hay nada guardado o está dañado o vencido. */
export function readCartItems(raw: string | null, now = Date.now()): CartItem[] | null {
  if (!raw) return null;
  const decoded = decodeCart(raw, now);
  return decoded.items.length || decoded.notice === "" ? decoded.items : null;
}
export function decodeCart(raw: string | null, now = Date.now()): { items: CartItem[]; notice: string } {
  if (!raw) return { items: [], notice: "" };
  try {
    if (raw.length > 200000) throw new Error();
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Number.isFinite(data.expiresAt) || data.expiresAt <= now || data.expiresAt > now + TTL + 60000 || !Array.isArray(data.items) || data.items.length > CART_MAX_LINES) throw new Error();
    const items = data.items.map(safeCartItem) as Array<CartItem | null>;
    if (items.some(item => !item) || new Set(items.map(item => cartLineKey(item!))).size !== items.length) throw new Error();
    return { items: items as CartItem[], notice: items.length ? "Carrito recuperado. Comprobaremos precios y disponibilidad antes de confirmar." : "" };
  } catch { return { items: [], notice: "No pudimos recuperar el carrito guardado. Puedes volver a agregar tus productos." }; }
}
export const encodeCart = (items: CartItem[], now = Date.now()) => JSON.stringify({ version: 1, expiresAt: now + TTL, items: items.map(safeCartItem).filter(Boolean) });
