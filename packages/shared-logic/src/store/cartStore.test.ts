import { describe, expect, it } from "vitest";
import { calculateLocalCartTotals, useCartStore } from "./cartStore";

describe("calculateLocalCartTotals", () => {
  it("calcula subtotal, monedas y faltante de envío gratis", () => {
    const totals = calculateLocalCartTotals([{ productId: "1", variantSku: "P-1", title: "Protein", variantLabel: "Chocolate", unitPrice: 30, quantity: 2, vitalCoinsReward: 3 }], 75);
    expect(totals).toMatchObject({ subtotal: 60, earnedCoins: 6, amountUntilFreeShipping: 15, hasFreeShipping: false });
  });
});

describe("apertura del carrito", () => {
  const item = { productId: "1", variantSku: "P-1", title: "Protein", variantLabel: "Chocolate", unitPrice: 30, quantity: 1, vitalCoinsReward: 0 };
  it("agregar abre el cajón por defecto y puede agregar sin interrumpir la navegación", () => {
    useCartStore.setState({ items: [], isOpen: false, view: "cart", notice: "" });
    useCartStore.getState().addItem(item, { open: false });
    expect(useCartStore.getState()).toMatchObject({ isOpen: false, notice: "Producto agregado al carrito." });
    useCartStore.getState().addItem(item);
    expect(useCartStore.getState()).toMatchObject({ isOpen: true, view: "cart" });
    expect(useCartStore.getState().items[0]?.quantity).toBe(2);
  });
  it("«Comprar ahora» abre directamente en el paso de entrega", () => {
    useCartStore.getState().toggleCart(true, "checkout");
    expect(useCartStore.getState()).toMatchObject({ isOpen: true, view: "checkout" });
    useCartStore.getState().toggleCart(false);
    expect(useCartStore.getState()).toMatchObject({ isOpen: false, view: "cart" });
  });
});

describe("tope por existencias conocidas", () => {
  const item = { productId: "2", variantSku: "P-2", title: "Creatina", variantLabel: "300 g", unitPrice: 20, quantity: 1, vitalCoinsReward: 0, maxQuantity: 3 };
  it("no supera las unidades disponibles al agregar ni al cambiar la cantidad", () => {
    useCartStore.setState({ items: [], isOpen: false, view: "cart", notice: "" });
    for (let i = 0; i < 5; i++) useCartStore.getState().addItem(item, { open: false });
    expect(useCartStore.getState().items[0]?.quantity).toBe(3);
    expect(useCartStore.getState().notice).toBe("Solo quedan 3 unidades disponibles de esta presentación.");
    useCartStore.getState().setQuantity("P-2", 4, "2");
    expect(useCartStore.getState().items[0]?.quantity).toBe(3);
    useCartStore.getState().setQuantity("P-2", 2, "2");
    expect(useCartStore.getState().items[0]?.quantity).toBe(2);
  });
});
