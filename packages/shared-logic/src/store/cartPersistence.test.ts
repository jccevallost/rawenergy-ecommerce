import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CART_MAX_QUANTITY, CART_STORAGE_KEY, decodeCart, encodeCart, safeCartItem } from "./cartPersistence";
import { useCartStore } from "./cartStore";
const item = { productId: "product-a", variantSku: "SAME-SKU", title: "Producto", variantLabel: "300 g", unitPrice: 25, quantity: 1 };
beforeEach(() => { useCartStore.setState({ items: [], notice: "", isOpen: false, view: "cart" }); });
afterEach(() => vi.unstubAllGlobals());
describe("Carrito persistente defensivo", () => {
  it("restaura productos y cantidades sin datos de cliente", () => {
    const raw = encodeCart([{ ...item, email: "private@example.test" } as typeof item]);
    expect(raw).not.toContain("private");
    expect(decodeCart(raw).items).toEqual([{ ...item }]);
  });
  it.each(["{", '{"version":9}', "null", JSON.stringify({ version: 1, expiresAt: 1, items: [item] })])("rechaza almacenamiento dañado, desconocido o vencido: %s", raw => {
    expect(decodeCart(raw).items).toEqual([]); expect(decodeCart(raw).notice).toBeTruthy();
  });
  it.each([0, -1, 1.5, NaN, Infinity, 100])("rechaza cantidad inválida %s", quantity => expect(safeCartItem({ ...item, quantity })).toBeNull());
  it("conserva el tope de existencias válido y descarta uno manipulado", () => {
    expect(decodeCart(encodeCart([{ ...item, maxQuantity: 4 }])).items[0]?.maxQuantity).toBe(4);
    for (const maxQuantity of [0, -3, 2.5, NaN, "9"]) expect(safeCartItem({ ...item, maxQuantity })?.maxQuantity).toBeUndefined();
  });
  it("descarta URL ejecutable y rechaza precio no finito", () => {
    expect(safeCartItem({ ...item, image: "javascript:alert(1)" })?.image).toBeUndefined();
    expect(safeCartItem({ ...item, unitPrice: Infinity })).toBeNull();
  });
  it("no combina ni elimina productos distintos con igual SKU", () => {
    useCartStore.getState().addItem(item); useCartStore.getState().addItem({ ...item, productId: "product-b" });
    expect(useCartStore.getState().items).toHaveLength(2);
    useCartStore.getState().setQuantity(item.variantSku, 3, "product-b");
    expect(useCartStore.getState().items.map(item => item.quantity)).toEqual([1, 3]);
    useCartStore.getState().removeItem(item.variantSku, "product-a");
    expect(useCartStore.getState().items[0]?.productId).toBe("product-b");
  });
  it("limita repeticiones a CART_MAX_QUANTITY y conserva memoria si localStorage falla", () => {
    vi.stubGlobal("localStorage", { setItem() { throw new Error("blocked"); } });
    useCartStore.getState().addItem({ ...item, quantity: CART_MAX_QUANTITY }); useCartStore.getState().addItem(item);
    expect(useCartStore.getState().items[0]?.quantity).toBe(CART_MAX_QUANTITY);
    expect(useCartStore.getState().notice).toContain("No se pudo guardar");
    useCartStore.getState().setQuantity(item.variantSku, NaN, item.productId);
    expect(useCartStore.getState().items[0]?.quantity).toBe(CART_MAX_QUANTITY);
  });
  it("acepta carritos guardados antes de C67 con el campo de puntos retirado", () => {
    const restored = safeCartItem({ ...item, vitalCoinsReward: 3 });
    expect(restored).not.toBeNull();
    expect(restored).not.toHaveProperty("vitalCoinsReward");
  });
  it("un carrito guardado con más unidades que el tope nuevo se recorta, no se pierde", () => {
    expect(safeCartItem({ ...item, quantity: 35 })?.quantity).toBe(CART_MAX_QUANTITY);
    expect(safeCartItem({ ...item, quantity: 150 })).toBeNull();
  });
  it("confirmar consume solo lo comprado y conserva lo añadido mientras respondía el servidor", () => {
    useCartStore.getState().addItem(item); useCartStore.getState().addItem(item);
    useCartStore.getState().addItem({ ...item, productId: "new-product" });
    useCartStore.getState().consume([item]);
    expect(useCartStore.getState().items.map(item => item.quantity)).toEqual([1, 1]);
  });
  it("rechaza más de 60 líneas y duplicados restaurados", () => {
    const raw = JSON.stringify({ version: 1, expiresAt: Date.now() + 10000, items: [item, item] });
    expect(decodeCart(raw).items).toEqual([]);
    for (let index = 0; index < 61; index++) useCartStore.getState().addItem({ ...item, productId: String(index) });
    expect(useCartStore.getState().items).toHaveLength(60);
  });
});

describe("Carrito en varias pestañas (P03)", () => {
  const memoryStorage = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } }; };
  const otherTabWrites = (items: typeof item[]) => localStorage.setItem(CART_STORAGE_KEY, encodeCart(items));
  it("un cambio de esta pestaña conserva lo que otra agregó aunque su aviso no haya llegado", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    useCartStore.getState().addItem(item, { open: false });
    otherTabWrites([{ ...item, quantity: 1 }, { ...item, productId: "otra-pestana" }]);
    useCartStore.getState().setQuantity(item.variantSku, 3, item.productId);
    expect(useCartStore.getState().items.map(line => [line.productId, line.quantity])).toEqual([["product-a", 3], ["otra-pestana", 1]]);
    expect(useCartStore.getState().notice).toMatch(/otra pestaña/);
    expect(decodeCart(localStorage.getItem(CART_STORAGE_KEY)).items).toHaveLength(2);
  });
  it("otra pestaña que quitó un producto no lo ve resucitar al agregar otro aquí", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    useCartStore.getState().addItem(item, { open: false });
    useCartStore.getState().addItem({ ...item, productId: "quitado" }, { open: false });
    otherTabWrites([{ ...item }]);
    useCartStore.getState().addItem({ ...item, productId: "nuevo" }, { open: false });
    expect(useCartStore.getState().items.map(line => line.productId)).toEqual(["product-a", "nuevo"]);
  });
  it("tras un pedido en esta pestaña se descuenta lo comprado y se conserva lo que otra agregó mientras tanto", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    useCartStore.getState().addItem({ ...item, quantity: 2 }, { open: false });
    otherTabWrites([{ ...item, quantity: 2 }, { ...item, productId: "mientras-tanto" }]);
    useCartStore.getState().consume([{ ...item, quantity: 2 }]);
    expect(useCartStore.getState().items.map(line => line.productId)).toEqual(["mientras-tanto"]);
  });
  it("si guardar falló, el siguiente cambio parte de esta pestaña y no de lo guardado viejo", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    useCartStore.getState().addItem(item, { open: false });
    vi.stubGlobal("localStorage", { ...storage, setItem() { throw new Error("lleno"); } });
    useCartStore.getState().addItem({ ...item, productId: "sin-guardar" }, { open: false });
    useCartStore.getState().setQuantity(item.variantSku, 2, item.productId);
    expect(useCartStore.getState().items.map(line => line.productId)).toEqual(["product-a", "sin-guardar"]);
    vi.stubGlobal("localStorage", storage);
    useCartStore.getState().addItem({ ...item, productId: "ya-guarda" }, { open: false });
    expect(decodeCart(localStorage.getItem(CART_STORAGE_KEY)).items.map(line => line.productId)).toEqual(["product-a", "sin-guardar", "ya-guarda"]);
  });
  it("lo guardado dañado no borra el carrito de esta pestaña", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    useCartStore.getState().addItem(item, { open: false });
    localStorage.setItem(CART_STORAGE_KEY, "{roto");
    useCartStore.getState().addItem({ ...item, productId: "segundo" }, { open: false });
    expect(useCartStore.getState().items).toHaveLength(2);
  });
});
