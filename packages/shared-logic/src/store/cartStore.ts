import { create } from "zustand";
import type { CartItem, CartTotals } from "../types";
import { CART_MAX_LINES, CART_MAX_QUANTITY, CART_STORAGE_KEY, cartLineKey, decodeCart, encodeCart, readCartItems, safeCartItem } from "./cartPersistence";
export { CART_STORAGE_KEY, CART_MAX_QUANTITY, safeImageUrl } from "./cartPersistence";

export type CartView = "cart" | "checkout";
type CartState = {
  items: CartItem[];
  isOpen: boolean;
  /** Paso en el que se abre el cajon. "checkout" lo usa «Comprar ahora». */
  view: CartView;
  notice: string;
  /** `open: false` agrega sin abrir el cajon, para seguir explorando. */
  addItem: (item: CartItem, options?: { open?: boolean }) => void;
  removeItem: (variantSku: string, productId: string) => void;
  setQuantity: (variantSku: string, quantity: number, productId: string) => void;
  toggleCart: (force?: boolean, view?: CartView) => void;
  clear: () => void;
  consume: (purchased: CartItem[]) => void;
};
/** Tope por línea: CART_MAX_QUANTITY o las existencias conocidas al agregar, lo que sea menor. */
export const lineCap = (item: Pick<CartItem, "maxQuantity">) => Math.min(CART_MAX_QUANTITY, item.maxQuantity ?? CART_MAX_QUANTITY);
const capNotice = (cap: number) => cap < CART_MAX_QUANTITY
  ? `Solo ${cap === 1 ? "queda 1 unidad disponible" : `quedan ${cap} unidades disponibles`} de esta presentación.`
  : `Máximo ${CART_MAX_QUANTITY} unidades por presentación; para más, escríbenos por WhatsApp.`;
function restore() {
  try { return decodeCart(globalThis.localStorage?.getItem(CART_STORAGE_KEY) ?? null); }
  catch { return { items: [], notice: "El navegador no permite guardar el carrito. Se conservará mientras esta página siga abierta." }; }
}
// Si el último guardado falló, lo guardado es más viejo que esta pestaña.
let storageBehind = false;
function save(items: CartItem[], notice = "") {
  try { globalThis.localStorage?.setItem(CART_STORAGE_KEY, encodeCart(items)); storageBehind = false; return { items, notice }; }
  catch { storageBehind = true; return { items, notice: "No se pudo guardar el carrito en este navegador. No cierres la página antes de terminar." }; }
}
const OTHER_TAB = "Actualizamos el carrito con los cambios de otra pestaña.";
/**
 * Cada cambio parte de lo último guardado y no de la copia de esta pestaña: si
 * otra pestaña cambió el carrito y su aviso aún no llegó (o esta estuvo en
 * segundo plano), su cambio no se pierde (P03).
 */
function latest(items: CartItem[]): { items: CartItem[]; otherTab: boolean } {
  if (storageBehind) return { items, otherTab: false };
  let stored: CartItem[] | null;
  try { stored = readCartItems(globalThis.localStorage?.getItem(CART_STORAGE_KEY) ?? null); }
  catch { return { items, otherTab: false }; }
  if (!stored) return { items, otherTab: false };
  return { items: stored, otherTab: JSON.stringify(stored) !== JSON.stringify(items) };
}
const withTabNotice = (base: { otherTab: boolean }, notice: string) => base.otherTab ? `${OTHER_TAB} ${notice}` : notice;
export const useCartStore = create<CartState>((set) => ({
  ...restore(), isOpen: false, view: "cart",
  addItem: (incoming, options) => set(state => {
    const item = safeCartItem(incoming);
    if (!item) return { notice: "No se pudo agregar el producto. Revisa la cantidad y vuelve a intentarlo." };
    const base = latest(state.items);
    const current = base.items.find(candidate => cartLineKey(candidate) === cartLineKey(item));
    if (!current && base.items.length >= CART_MAX_LINES) return { items: base.items, notice: withTabNotice(base, "El carrito admite hasta 60 presentaciones diferentes.") };
    const cap = lineCap(item);
    const quantity = Math.min(cap, (current?.quantity ?? 0) + item.quantity);
    const items = current ? base.items.map(candidate => cartLineKey(candidate) === cartLineKey(item) ? { ...item, quantity } : candidate) : [...base.items, item];
    const open = options?.open ?? true;
    const notice = quantity < (current?.quantity ?? 0) + item.quantity ? capNotice(cap) : "Producto agregado al carrito.";
    return { ...save(items, withTabNotice(base, notice)), ...(open ? { isOpen: true, view: "cart" as const } : {}) };
  }),
  removeItem: (sku, id) => set(state => { const base = latest(state.items); return save(base.items.filter(item => item.variantSku !== sku || item.productId !== id), withTabNotice(base, "Producto eliminado del carrito.")); }),
  setQuantity: (sku, quantity, id) => set(state => {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > CART_MAX_QUANTITY) return { notice: `Usa una cantidad entera entre 1 y ${CART_MAX_QUANTITY}.` };
    const base = latest(state.items);
    const line = base.items.find(item => item.variantSku === sku && item.productId === id);
    if (line && quantity > lineCap(line)) return { items: base.items, notice: withTabNotice(base, capNotice(lineCap(line))) };
    return save(quantity === 0 ? base.items.filter(item => item.variantSku !== sku || item.productId !== id) : base.items.map(item => item.variantSku === sku && item.productId === id ? { ...item, quantity } : item), withTabNotice(base, "Cantidad actualizada."));
  }),
  toggleCart: (force, view = "cart") => set(state => ({ isOpen: force ?? !state.isOpen, view })),
  clear: () => set(save([])),
  consume: purchased => set(state => save(latest(state.items).items.flatMap(item => {
    const quantity = item.quantity - (purchased.find(line => cartLineKey(line) === cartLineKey(item))?.quantity ?? 0);
    return quantity > 0 ? [{ ...item, quantity }] : [];
  })))
}));
// Another tab's saved snapshot is explicit; no customer/payment data is stored here.
if (typeof window !== "undefined") {
  window.addEventListener("storage", event => {
    if (event.key !== CART_STORAGE_KEY || event.storageArea !== localStorage) return;
    const recovered = decodeCart(event.newValue);
    useCartStore.setState({ items: recovered.items, notice: "El carrito cambió en otra pestaña. Revisa productos y cantidades antes de confirmar." });
  });
  // Una pestaña congelada en segundo plano o restaurada desde la caché de Atrás
  // no recibió esos avisos: al volver se compara con lo guardado.
  const resync = () => {
    const base = latest(useCartStore.getState().items);
    if (base.otherTab) useCartStore.setState({ items: base.items, notice: "El carrito cambió en otra pestaña. Revisa productos y cantidades antes de confirmar." });
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resync(); });
  window.addEventListener("pageshow", event => { if (event.persisted) resync(); });
}
export const calculateLocalCartTotals = (items: CartItem[], threshold = 70): CartTotals => {
  const subtotal = Math.round(items.reduce((sum, item) => sum + Math.round(item.unitPrice * item.quantity * 100), 0)) / 100;
  return { subtotal, discount: 0, shippingFee: 0, total: subtotal, freeShippingThreshold: threshold, amountUntilFreeShipping: Math.max(0, Math.round((threshold - subtotal) * 100) / 100), hasFreeShipping: subtotal >= threshold };
};
