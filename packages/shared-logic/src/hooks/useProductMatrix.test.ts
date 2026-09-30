import { describe, expect, it } from "vitest";
import { generateVariantMatrix } from "./useProductMatrix";

const sizes = [{ value: 2, unit: "lb" }];

describe("generateVariantMatrix", () => {
  it("deriva el SKU del slug del producto", () => {
    const [variante] = generateVariantMatrix("beta-alanina-pura", ["Chocolate"], sizes);
    expect(variante!.sku).toBe("BETA-ALANINA-PURA-CHOCOLATE-2LB");
  });

  it("no cambia un SKU existente al regenerar con otro slug", () => {
    // El editor actualiza los SKU automáticos sólo en fichas nuevas.
    const inicial = generateVariantMatrix("", ["Chocolate"], sizes);
    expect(inicial[0]!.sku).toBe("PRODUCTO-CHOCOLATE-2LB");

    const conPrecio = [{ ...inicial[0]!, price: 24.9, stock: 30 }];
    const final = generateVariantMatrix("beta-alanina-pura", ["Chocolate"], sizes, conPrecio);
    expect(final[0]!.sku).toBe("PRODUCTO-CHOCOLATE-2LB");
    // El precio y el stock que ya cargo el operador se conservan.
    expect(final[0]!.price).toBe(24.9);
    expect(final[0]!.stock).toBe(30);
  });

  it("respeta un SKU escrito a mano", () => {
    const propio = [{ flavor: "Chocolate", size: sizes[0]!, price: 59.9, compareAtPrice: null, stock: 18, sku: "GS-WHEY-CHOC-2LB", images: [] }];
    const final = generateVariantMatrix("gold-standard-100-whey", ["Chocolate"], sizes, propio);
    expect(final[0]!.sku).toBe("GS-WHEY-CHOC-2LB");
  });

  it("conserva las filas ya cargadas al agregar una combinacion nueva", () => {
    const previo = generateVariantMatrix("beta-alanina-pura", ["Chocolate"], sizes).map((v) => ({ ...v, price: 24.9 }));
    const final = generateVariantMatrix("beta-alanina-pura", ["Chocolate", "Vainilla"], sizes, previo);
    expect(final).toHaveLength(2);
    expect(final[0]!.price).toBe(24.9);
    expect(final[1]!.price).toBe(0);
  });

  it("limita códigos largos y evita colisiones al normalizar opciones", () => {
    const variants = generateVariantMatrix("producto-".repeat(20), ["Café", "Cafe", "Café"], [{value: 300, unit: "g"}]);
    expect(variants).toHaveLength(2);
    expect(new Set(variants.map(v => v.sku)).size).toBe(2);
    expect(variants.every(v => v.sku.length <= 80)).toBe(true);
  });
});
