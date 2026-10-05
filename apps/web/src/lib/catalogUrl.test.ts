import { describe, expect, it } from "vitest";
import { activeFilterCount, catalogHref, filtersFromSearch } from "./catalogUrl";

const parse = (query: string) => filtersFromSearch(new URLSearchParams(query));

describe("filtros del catálogo en la URL", () => {
  it("ida y vuelta: lo que se comparte es lo que se vuelve a leer", () => {
    const filters = { search: "whey isolate", brands: ["Dymatize", "Nutrex"], goals: ["energia"], inStock: true, minPrice: 10, maxPrice: 80.5, sort: "PRICE_DESC" as const };
    const href = catalogHref(filters);
    expect(href.startsWith("/catalogo?")).toBe(true);
    expect(parse(href.split("?")[1]!)).toEqual(filters);
    expect(activeFilterCount(filters)).toBe(6);
    expect(catalogHref()).toBe("/catalogo");
  });

  it("descarta valores manipulados en lugar de enviarlos a la API", () => {
    const filters = parse(`q=${"x".repeat(200)}&min=abc&max=-5&orden=DROP&disponible=si&uso=<script>&uso=energia&marca=${"m".repeat(90)}`);
    expect(filters.search).toHaveLength(80);
    expect(filters).not.toHaveProperty("minPrice");
    expect(filters).not.toHaveProperty("maxPrice");
    expect(filters).not.toHaveProperty("sort");
    expect(filters).not.toHaveProperty("inStock");
    expect(filters).not.toHaveProperty("brands");
    expect(filters.goals).toEqual(["energia"]);
  });

  it("limita repeticiones y elimina duplicados", () => {
    const many = Array.from({ length: 30 }, (_, index) => `marca=M${index}`).join("&");
    expect(parse(many).brands).toHaveLength(12);
    expect(parse("marca=Evogen&marca=Evogen&marca=%20").brands).toEqual(["Evogen"]);
    expect(parse("min=0").minPrice).toBe(0);
  });
  it("lee y escribe el tipo de producto (C65)", () => {
    const filters = filtersFromSearch(new URLSearchParams("tipo=creatina&tipo=preentreno&tipo=MAL%20escrito"));
    expect(filters.categories).toEqual(["creatina", "preentreno"]);
    expect(catalogHref({ categories: ["creatina"] })).toBe("/catalogo?tipo=creatina");
  });
});
