import { describe, expect, it } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { productService } from "./product.service.js";
import { defaultCommerceSettings } from "./commerceSettings.service.js";
import { unitOfWork } from "../lib/unitOfWork.js";

const rules = (freeShippingThreshold: number) => ({ ...defaultCommerceSettings(), freeShippingThreshold });

const idsOf = (result: { edges: Array<{ node: unknown }> }) =>
  result.edges.map((edge) => String((edge.node as { id?: unknown }).id ?? ""));

describe("ProductService demo mode", () => {
  it("ordena por precio en todas las páginas sin perder productos con el mismo precio", async () => {
    const payload = demoProducts[1]!;
    const twin = await productService.upsert(undefined, { ...payload, slug: "creatina-precio-igual", variants: payload.variants.map(v => ({ ...v, sku: `${v.sku}-TWIN`, stock: 0 })) }) as { id: string };
    try {
      for (const sort of ["PRICE_ASC", "PRICE_DESC"] as const) {
        const prices: number[] = [];
        const ids: string[] = [];
        let after: string | undefined;
        let hasNext = true;
        while (hasNext) {
          const result = await productService.search({ sort }, { first: 1, after });
          for (const edge of result.edges) { prices.push(edge.node.priceRange!.min!); ids.push(String("id" in edge.node ? edge.node.id : edge.node._id)); }
          after = result.pageInfo.endCursor ?? undefined;
          hasNext = result.pageInfo.hasNextPage;
          expect(ids.length).toBeLessThan(demoProducts.length + 5);
        }
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toHaveLength(demoProducts.length + 1);
        expect(prices).toEqual([...prices].sort((a, b) => sort === "PRICE_ASC" ? a - b : b - a));
      }
    } finally { await productService.archive(twin.id); }
  });

  it("combina precio inicial, marca, búsqueda y disponibilidad", async () => {
    const result = await productService.search({ search: "creatine", brands: ["Dragon Pharma"], minPrice: 30, maxPrice: 35, inStock: true, sort: "PRICE_ASC" });
    expect(idsOf(result)).toEqual(["demo-2"]);
    expect((await productService.search({ minPrice: 200 })).totalCount).toBe(0);
    expect(await productService.catalogBrands()).toContain("Dragon Pharma");
  });

  it("busca igual con o sin tildes y espacios exteriores", async () => {
    expect(idsOf(await productService.search({ search: "  PROTEÍNA  " }))).toEqual(idsOf(await productService.search({ search: "proteina" })));
    expect((await productService.search({ search: "PROTEÍNA" })).totalCount).toBeGreaterThan(0);
  });

  it("rechaza cursores incompatibles con orden por precio", async () => {
    await expect(productService.search({ sort: "PRICE_ASC" }, { after: Buffer.from("invalid").toString("base64url") })).rejects.toThrow("página cambió");
  });

  it("pagina con cursores y filtra por objetivo", async () => {
    const result = await productService.search({ goals: ["energia"] }, { first: 1 });
    expect(result.edges).toHaveLength(1);
    expect(result.totalCount).toBeGreaterThan(1);
    expect(result.pageInfo.hasNextPage).toBe(true);
  });

  it("calcula el carrito con precios del servidor", async () => {
    const result = await productService.calculateCart([{ productId: "demo-2", variantSku: "DP-CREATINE-300G", quantity: 2 }], undefined, rules(75));
    expect(result.subtotal).toBe(69.8);
    expect(result.amountUntilFreeShipping).toBeCloseTo(5.2);
  });

  it("suma el envio al total segun el metodo elegido", async () => {
    const item = [{ productId: "demo-2", variantSku: "DP-CREATINE-300G", quantity: 1 }];
    const express = await productService.calculateCart(item, "EXPRESS_QUITO_VALLES", rules(70));
    expect(express.shippingFee).toBe(4);
    expect(express.total).toBe(38.9);

    const nacional = await productService.calculateCart(item, "SERVIENTREGA_NATIONAL", rules(70));
    expect(nacional.shippingFee).toBe(5);

    const sobreUmbral = await productService.calculateCart(item, "EXPRESS_QUITO_VALLES", rules(10));
    expect(sobreUmbral.shippingFee).toBe(0);
  });

  it("archivar saca el producto del catalogo publico y restaurar lo devuelve", async () => {
    const inicial = await productService.search({}, { first: 40 });
    const objetivo = idsOf(inicial)[0]!;
    expect(objetivo).toBeTruthy();

    await productService.archive(objetivo);

    const activos = await productService.search({}, { first: 40 });
    expect(idsOf(activos)).not.toContain(objetivo);

    const archivados = await productService.search({ status: "ARCHIVED" }, { first: 40 });
    expect(idsOf(archivados)).toContain(objetivo);

    const todos = await productService.search({ status: "ALL" }, { first: 40 });
    expect(idsOf(todos)).toContain(objetivo);

    await productService.restore(objetivo);
    const restaurados = await productService.search({}, { first: 40 });
    expect(idsOf(restaurados)).toContain(objetivo);
  });

  it("un producto archivado no se puede cotizar ni pedir", async () => {
    const item = { productId: "demo-2", variantSku: "DP-CREATINE-300G", quantity: 1 };

    expect(await productService.getSellable(item.productId)).not.toBeNull();
    await expect(productService.calculateCart([item])).resolves.toBeTruthy();

    await productService.archive(item.productId);

    expect(await productService.getSellable(item.productId)).toBeNull();
    await expect(productService.calculateCart([item])).rejects.toThrow();
    // el admin si debe poder seguir leyendolo para editarlo o restaurarlo
    expect(await productService.get(item.productId)).not.toBeNull();

    await productService.restore(item.productId);
    expect(await productService.getSellable(item.productId)).not.toBeNull();
  });

  it("filtra destacados reales y resuelve el slug público solo si el producto se vende", async () => {
    const featured = await productService.search({ featured: true }, { first: 50 });
    expect(featured.totalCount).toBe(demoProducts.filter(product => product.featured).length);
    expect(featured.edges.every(edge => (edge.node as { featured?: boolean }).featured === true)).toBe(true);

    const payload = { ...demoProducts[2]!, slug: "producto-por-slug", featured: false, variants: demoProducts[2]!.variants.map(v => ({ ...v, sku: `${v.sku}-SLUG` })) };
    const created = await productService.upsert(undefined, payload) as { id: string };
    expect(String((await productService.getSellableBySlug("producto-por-slug") as { id?: string } | null)?.id)).toBe(created.id);
    expect(await productService.getSellableBySlug("no-existe")).toBeNull();
    await productService.archive(created.id);
    expect(await productService.getSellableBySlug("producto-por-slug")).toBeNull();
  });

  it("el precio «desde», el filtro y el orden usan solo presentaciones con existencias (P08)", async () => {
    const base = demoProducts[1]!;
    const variant = (sku: string, price: number, stock: number) => ({ ...base.variants[0]!, sku, flavor: sku, price, stock });
    const payload = { ...base, slug: "rango-vendible", featured: false, variants: [variant("RANGO-BARATA", 21.5, 0), variant("RANGO-MEDIA", 38.25, 3), variant("RANGO-CARA", 52, 2)] };
    const { id } = await productService.upsert(undefined, payload) as { id: string };
    const range = async () => (await productService.get(id) as { priceRange: { min: number; max: number } }).priceRange;
    const listed = async (minPrice: number, maxPrice: number) => idsOf(await productService.search({ minPrice, maxPrice }, { first: 100 })).includes(id);
    const position = async () => idsOf(await productService.search({ sort: "PRICE_ASC" }, { first: 100 })).indexOf(id);
    try {
      expect(await range()).toEqual({ min: 38.25, max: 52 });
      expect(await listed(20, 22)).toBe(false);
      expect(await listed(38, 39)).toBe(true);
      const whileSoldOut = await position();
      await productService.changeStock(id, "RANGO-BARATA", 4, { reason: "Reposición de prueba" });
      expect(await range()).toEqual({ min: 21.5, max: 52 });
      expect(await listed(20, 22)).toBe(true);
      expect(await position()).toBeLessThan(whileSoldOut);
      await productService.changeStock(id, "RANGO-BARATA", -4, { reason: "Venta de prueba" });
      await productService.changeStock(id, "RANGO-CARA", -2, { reason: "Venta de prueba" });
      expect(await range()).toEqual({ min: 38.25, max: 38.25 });
      // Todo agotado: rango completo; la tienda muestra «Agotado» y no un precio imposible de comprar.
      await productService.changeStock(id, "RANGO-MEDIA", -3, { reason: "Venta de prueba" });
      expect(await range()).toEqual({ min: 21.5, max: 52 });
      // Una edición de la ficha con la barata sin stock tampoco la usa como «desde».
      await productService.upsert(id, { ...payload, variants: [variant("RANGO-BARATA", 21.5, 0), variant("RANGO-MEDIA", 38.25, 1), variant("RANGO-CARA", 52, 0)] });
      expect(await range()).toEqual({ min: 38.25, max: 38.25 });
    } finally { await productService.archive(id); }
  });

  it("una reserva revertida devuelve también el rango de precio", async () => {
    const base = demoProducts[1]!;
    const payload = { ...base, slug: "rango-revertido", featured: false, variants: [{ ...base.variants[0]!, sku: "REV-BARATA", price: 10, stock: 1 }, { ...base.variants[0]!, sku: "REV-CARA", price: 20, stock: 1 }] };
    const { id } = await productService.upsert(undefined, payload) as { id: string };
    try {
      await expect(unitOfWork(async () => { await productService.changeStock(id, "REV-BARATA", -1, { reason: "Venta que falla" }); throw new Error("fallo posterior"); })).rejects.toThrow("fallo posterior");
      expect((await productService.get(id) as { priceRange: { min: number } }).priceRange.min).toBe(10);
    } finally { await productService.archive(id); }
  });
});
