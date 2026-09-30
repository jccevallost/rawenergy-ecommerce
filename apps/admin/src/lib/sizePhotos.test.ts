import { describe, expect, it } from "vitest";
import type { VariantDraft } from "@vital-forge/shared-logic";
import { addToSize, altInSize, coverOfSize, photoAlt, removeFromSize, sizeGroups } from "./sizePhotos";

const v = (flavor: string, value: number, unit: string, images: string[] = []): VariantDraft => ({ flavor, size: { value, unit }, price: 10, stock: 1, sku: `${flavor}-${value}${unit}`, images: images.map(url => ({ url, alt: url })) } as VariantDraft);

describe("fotos por tamaño (C48)", () => {
  it("agrupa por tamaño y muestra solo las fotos que comparten todos sus sabores", () => {
    const groups = sizeGroups([v("Chocolate", 2, "lb", ["a", "b"]), v("Vainilla", 2, "lb", ["b", "c"]), v("Chocolate", 5, "lb", ["d"])]);
    expect(groups.map(g => [g.key, g.indexes, g.common.map(p => p.url), g.free])).toEqual([["2 lb", [0, 1], ["b"], 6], ["5 lb", [2], ["d"], 7]]);
  });

  it("subir al tamaño agrega la foto a todos sus sabores, sin duplicar ni pasar de 8", () => {
    const full = v("Vainilla", 2, "lb", ["1", "2", "3", "4", "5", "6", "7", "8"]);
    const { next, added, full: skipped } = addToSize([v("Chocolate", 2, "lb", ["x"]), full, v("Chocolate", 5, "lb")], "2 lb", { url: "x", alt: "" });
    expect(added).toBe(0); expect(skipped).toBe(1);
    const second = addToSize(next, "2 lb", { url: "nueva", alt: "Gold, 2 lb" });
    expect(second.next[0]!.images.map(p => p.url)).toEqual(["x", "nueva"]);
    expect(second.next[2]!.images).toEqual([]);
  });

  it("quitar, portada y texto alternativo se aplican a todos los sabores del tamaño", () => {
    let list = [v("Chocolate", 2, "lb", ["a", "b"]), v("Vainilla", 2, "lb", ["c", "b"]), v("Chocolate", 5, "lb", ["b"])];
    list = coverOfSize(list, "2 lb", "b");
    expect(list.map(x => x.images[0]!.url)).toEqual(["b", "b", "b"]);
    list = altInSize(list, "2 lb", "b", "Envase de 2 lb");
    expect(list[1]!.images[0]!.alt).toBe("Envase de 2 lb");
    expect(list[2]!.images[0]!.alt).toBe("b");
    list = removeFromSize(list, "2 lb", "b");
    expect(list.map(x => x.images.map(p => p.url))).toEqual([["a"], ["c"], ["b"]]);
  });

  it("el texto alternativo por omisión describe el producto, no el SKU", () => {
    expect(photoAlt("Gold Standard 100% Whey", v("Double Rich Chocolate", 2, "lb"))).toBe("Gold Standard 100% Whey, Double Rich Chocolate, 2 lb");
  });
});
