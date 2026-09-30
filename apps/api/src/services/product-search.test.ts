import { describe, expect, it } from "vitest";
import { productService, searchTerms } from "./product.service.js";

const titles = async (search: string) => (await productService.search({ search }, { first: 100 })).edges.map(edge => (edge.node as { title: string }).title);

describe("Búsqueda por palabras, sabor y tamaño (C47)", () => {
  it("separa palabras, ignora conectores y reconoce tamaños escritos de varias formas", () => {
    expect(searchTerms("Creatina de 300 g")).toEqual({ words: ["creatina"], sizes: [{ value: 300, unit: "g" }] });
    expect(searchTerms("whey 5lbs").sizes).toEqual([{ value: 5, unit: "lb" }]);
    expect(searchTerms("1 kilo").sizes).toEqual([{ value: 1, unit: "kg" }]);
    expect(searchTerms("1,6 libras").sizes).toEqual([{ value: 1.6, unit: "lb" }]);
    expect(searchTerms("35 porciones").sizes).toEqual([{ value: 35, unit: "porciones" }]);
    expect(searchTerms("de la y")).toEqual({ words: [], sizes: [] });
  });

  it("encuentra con palabras sueltas en cualquier orden y sin tildes", async () => {
    expect(await titles("gold whey")).toContain("Gold Standard 100% Whey");
    expect(await titles("whey gold")).toContain("Gold Standard 100% Whey");
    expect(await titles("proteina")).not.toHaveLength(0);
  });

  it("busca por sabor y por categoría en español aunque el nombre esté en inglés", async () => {
    expect(await titles("vanilla")).toContain("Gold Standard 100% Whey");
    expect(await titles("creatina")).toEqual(expect.arrayContaining(["Creatine Monohydrate"]));
  });

  it("entiende sabores en español aunque la marca los escriba en inglés (C53)", async () => {
    expect(await titles("vainilla")).toContain("Gold Standard 100% Whey");
    expect(await titles("proteina vainilla 5 lb")).toContain("Gold Standard 100% Whey");
    expect(await titles("uva")).toEqual(expect.arrayContaining(["Psychotic Gold"]));
  });

  it("filtra por tamaño: «creatina 300 g» no trae la de 600 g sola ni otros productos", async () => {
    const found = await titles("creatina 300 g");
    expect(found).toContain("Creatine Monohydrate");
    expect(found.every(title => /creatin/i.test(title))).toBe(true);
    expect(await titles("whey 5 lb")).toContain("Gold Standard 100% Whey");
    expect(await titles("whey 7 lb")).toEqual([]);
  });
});
