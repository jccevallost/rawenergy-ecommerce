import { unitOfWork, registerMemoryStore, operationContext } from "../lib/unitOfWork.js";
import { supplyService } from "./supply.service.js";
import { normalizedLots, recordMovement, type StockLot } from "./stockLedger.service.js";
import mongoose from "mongoose";
import { z } from "zod";
const lotPositionSchema = z.object({ warehouseId:z.string().min(1), lot:z.string().min(1), expiresOn:z.string(), unitCost:z.number().nonnegative().nullable() }).strict();
const stockAdjustmentSchema = z.object({ position:lotPositionSchema.optional(), expectedLotQuantity:z.number().int().nonnegative().optional(), productId: z.string().min(1), sku: z.string().min(3), delta: z.number().int().min(-100000).max(100000), expectedStock: z.number().int().nonnegative(), reorderPoint: z.number().int().nonnegative().max(100000).optional(), reason: z.string().trim().min(5).max(300) }).strict();
import { demoProducts } from "../data/demoProducts.js";
import { ProductModel } from "../models/Product.js";
import { productPayloadSchema, type ProductPayload } from "../validation/product.js";
import { type CommerceSettings, commerceSettingsService, shippingFee as feeFor, type ShippingMethod } from "./commerceSettings.service.js";
import { sellablePriceRange } from "../lib/priceRange.js";
import { evaluateCode } from "./welcomeDiscount.service.js";

type ProductStatus = "ACTIVE" | "ARCHIVED" | "ALL";
type SearchFilters = { search?: string; brands?: string[]; categories?: string[]; goals?: string[]; flavors?: string[]; status?: ProductStatus; sort?: "PRICE_ASC" | "PRICE_DESC"; minPrice?: number; maxPrice?: number; inStock?: boolean; featured?: boolean };
type DemoRecord = ProductPayload & { id: string; priceRange: { min: number; max: number }; active: boolean; revision: number; variants: Array<ProductPayload["variants"][number] & { lots?: StockLot[] }> };
export type TaxonomyKind = "CATEGORY" | "GOAL" | "BRAND";
export type TaxonomyAction = "RENAME" | "MERGE" | "REMOVE";
export type TaxonomyEntry = { key: string; name: string; productCount: number };
export type TaxonomyOverview = { categories: TaxonomyEntry[]; goals: TaxonomyEntry[]; brands: TaxonomyEntry[] };

const withDerivedFields = (payload: ProductPayload, id: string, active = true): DemoRecord =>
  ({ ...payload, id, revision: 0, priceRange: sellablePriceRange(payload.variants), active });
const encodeCursor = (id: string) => Buffer.from(id, "utf8").toString("base64url");
const decodeCursor = (cursor?: string | null) => cursor ? Buffer.from(cursor, "base64url").toString("utf8") : undefined;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Ver order.service: dos productos creados en el mismo milisegundo no pueden
// compartir id, o editar uno terminaria pisando al otro.
const normalizeSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
const searchPattern = (value: string) => escapeRegex(normalizeSearch(value)).replace(/[aeioun]/g, letter => ({ a: "[aáàäâ]", e: "[eéèëê]", i: "[iíìïî]", o: "[oóòöô]", u: "[uúùüû]", n: "[nñ]" })[letter]!);
// Búsqueda (C47): cada palabra debe aparecer en algún campo (nombre, marca, descripción,
// SKU, sabor, categoría u objetivo) y los tamaños escritos como «5 lb» o «300 g» se
// buscan en las presentaciones. «gold whey» encuentra «Gold Standard 100% Whey».
const unitAliases: Record<string, string> = { lb: "lb", lbs: "lb", libra: "lb", libras: "lb", g: "g", gr: "g", grs: "g", gramos: "g", kg: "kg", kilo: "kg", kilos: "kg", porcion: "porciones", porciones: "porciones", servicios: "porciones", medidas: "medidas", scoops: "medidas" };
const stopwords = new Set(["de", "del", "la", "el", "los", "las", "y", "para", "en", "con", "un", "una"]);
export function searchTerms(raw: string) {
  const sizes: Array<{ value: number; unit: string }> = [];
  const text = normalizeSearch(raw).replace(/(\d+(?:[.,]\d+)?)\s*(lbs?|libras?|kg|kilos?|grs?|gramos|g|porcion(?:es)?|servicios|medidas|scoops)\b/g, (_match: string, value: string, unit: string) => {
    sizes.push({ value: Number(value.replace(",", ".")), unit: unitAliases[unit] ?? unit }); return " ";
  });
  const words = text.split(/[\s,/]+/).filter(word => word.length >= 2 && !stopwords.has(word));
  return { words, sizes };
}
const searchFields = ["title", "brand", "shortDescription", "variants.sku", "variants.flavor", "categories.name", "goals.name"];
// Los sabores vienen en inglés desde las marcas: «vainilla» también busca «vanilla» (C53).
const synonyms: Record<string, string[]> = {
  vainilla: ["vanilla"], fresa: ["strawberry"], frutilla: ["strawberry"], uva: ["grape"], durazno: ["peach"], melocoton: ["peach"],
  galleta: ["cookie"], galletas: ["cookie"], canela: ["cinnamon"], avena: ["oatmeal"], limonada: ["lemonade"], limon: ["lemon"],
  ponche: ["punch"], frutas: ["fruit"], fruta: ["fruit"], caramelo: ["caramel", "candy"], dulce: ["candy"], arandano: ["blueberry"], mora: ["berry"],
  cafe: ["coffee", "mocha"], mani: ["peanut"], coco: ["coconut"], platano: ["banana"], sandia: ["watermelon"], naranja: ["orange"], manzana: ["apple"],
  natural: ["unflavored", "sin sabor"], neutro: ["unflavored", "sin sabor"], unflavored: ["sin sabor"]
};
export const wordAlternatives = (word: string) => [word, ...(synonyms[word] ?? [])];
let demoSequence = 0;
const demoId = () => `demo-${Date.now()}-${++demoSequence}`;

class ProductService {
  private useMongo = false;
  private demo = demoProducts.map((product, index) => withDerivedFields(product, `demo-${index + 1}`));

  constructor() { registerMemoryStore(() => this.demo, (value) => { this.demo = value; }); }

  /** "mongodb" o "demo": el panel debe poder decir sobre que esta operando. */
  get persistenceMode() {
    return this.useMongo ? "mongodb" : "demo";
  }

  async connect(uri?: string) {
    if (!uri) return { mode: "demo" as const };
    await mongoose.connect(uri);
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== "isdbgrid") { await mongoose.disconnect(); throw new Error("MongoDB requiere un replica set (Atlas o rs0 local) para guardar compras, pedidos e inventario en transacciones."); }
    this.useMongo = true;
    return { mode: "mongodb" as const };
  }

  async disconnect() {
    if (this.useMongo) await mongoose.disconnect();
  }

  /** Al arrancar: corrige el rango de productos guardados antes de C25 (incluía presentaciones agotadas). */
  async refreshPriceRanges(): Promise<number> {
    if (!this.useMongo) return 0;
    const rows = await ProductModel.find({}, { "variants.price": 1, "variants.stock": 1, priceRange: 1 }).lean();
    const updates = rows.flatMap((row) => {
      const next = sellablePriceRange(row.variants);
      if (next.min === row.priceRange?.min && next.max === row.priceRange?.max) return [];
      return [{ updateOne: { filter: { _id: row._id, "priceRange.min": row.priceRange?.min, "priceRange.max": row.priceRange?.max }, update: { $set: { priceRange: next } } } }];
    });
    if (updates.length) await ProductModel.bulkWrite(updates);
    return updates.length;
  }

  async allForManagement() {
    if (this.useMongo) return ProductModel.find({}).select("title active categories variants").lean();
    return this.demo;
  }

  async adjustStock(raw: unknown): Promise<unknown> {
    if (!operationContext.getStore()) return unitOfWork(() => this.adjustStock(raw));
    const input = stockAdjustmentSchema.parse(raw);
    const product = await this.get(input.productId);
    const variant = product?.variants.find((v) => v.sku === input.sku);
    if (!variant) throw new Error("Variante no encontrada");
    if (variant.stock !== input.expectedStock) throw new Error("El stock cambió. Actualiza el inventario antes de ajustar.");
    await this.changeStock(input.productId, input.sku, input.delta, { reason: input.reason, expectedStock: input.expectedStock, allowExpired: true, position:input.position, expectedLotQuantity:input.expectedLotQuantity });
    if (input.reorderPoint !== undefined && this.useMongo) await ProductModel.updateOne({ _id: input.productId, "variants.sku": input.sku }, { $set: { "variants.$.reorderPoint": input.reorderPoint } });
    else if (input.reorderPoint !== undefined) variant.reorderPoint = input.reorderPoint;
    return { ...input, stock: input.expectedStock + input.delta };
  }

  async changeStock(productId: string, sku: string, delta: number, options: { position?: z.infer<typeof lotPositionSchema>; expectedLotQuantity?:number; reason?: string; expectedStock?: number; warehouseId?: string; lot?: string; expiresOn?: string; unitCost?: number | null; exactLots?: StockLot[]; allowExpired?: boolean } = {}): Promise<StockLot[]> {
    if (!operationContext.getStore()) return unitOfWork(() => this.changeStock(productId, sku, delta, options));
    const product = await this.get(productId);
    const variant = product?.variants.find((v) => v.sku === sku);
    if (!product || !variant) throw new Error(`Variante no encontrada: ${sku}`);
    if (options.expectedStock !== undefined && options.expectedStock !== variant.stock) throw new Error("El stock cambió. Recarga antes de continuar.");
    const before = variant.stock;
    const lots = normalizedLots(variant as unknown as { stock: number; lots?: StockLot[] });
    if (options.position && options.expectedLotQuantity !== undefined) {
      const p=options.position;
      const quantity=lots.filter(l=>l.warehouseId===p.warehouseId&&l.lot===p.lot&&l.expiresOn===p.expiresOn&&l.unitCost===p.unitCost).reduce((sum,l)=>sum+l.quantity,0);
      if(quantity!==options.expectedLotQuantity)throw new Error("El lote cambió. Actualiza las existencias antes de ajustar.");
    }
    const allocation: StockLot[] = [];
    const today = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
    if (delta < 0) {
      let pending = -delta;
      lots.sort((a, b) => (a.expiresOn || "9999").localeCompare(b.expiresOn || "9999"));
      for (const lot of lots) {
        if(options.position && (lot.warehouseId!==options.position.warehouseId||lot.lot!==options.position.lot||lot.expiresOn!==options.position.expiresOn||lot.unitCost!==options.position.unitCost))continue;
        if (options.warehouseId && lot.warehouseId !== options.warehouseId || options.lot && lot.lot !== options.lot || !options.allowExpired && lot.expiresOn && lot.expiresOn < today) continue;
        const quantity = Math.min(pending, lot.quantity);
        if (quantity > 0) { allocation.push({ ...lot, quantity }); lot.quantity -= quantity; pending -= quantity; }
        if (!pending) break;
      }
      if (pending) throw new Error(`Stock insuficiente o vencido: ${sku}`);
    } else if (delta > 0) {
      const additions = options.exactLots ?? (options.position ? [{...options.position,quantity:delta}] : [{ warehouseId: options.warehouseId ?? "main", lot: options.lot || "SIN-LOTE", expiresOn: options.expiresOn ?? "", quantity: delta, unitCost: options.unitCost ?? null }]);
      if (additions.reduce((sum, l) => sum + l.quantity, 0) !== delta) throw new Error("Cantidades de lote inconsistentes");
      for (const add of additions) { const found = lots.find((l) => l.warehouseId === add.warehouseId && l.lot === add.lot && l.expiresOn === add.expiresOn && l.unitCost === add.unitCost); if (found) found.quantity += add.quantity; else lots.push({ ...add }); allocation.push({ ...add }); }
    }
    await supplyService.lockWarehouses(allocation.map(l => l.warehouseId), Boolean(options.allowExpired && delta < 0));
    const after = before + delta;
    if (this.useMongo) {
      // El rango vendible cambia cuando una presentación se agota o vuelve; la transacción evita calcularlo con otras variantes desactualizadas.
      const priceRange = sellablePriceRange(product.variants.map((v) => v.sku === sku ? { price: v.price, stock: after } : v));
      const result = await ProductModel.updateOne({ _id: productId, variants: { $elemMatch: { sku, stock: before } } }, { $set: { "variants.$.stock": after, "variants.$.lots": lots.filter((l) => l.quantity > 0), priceRange } });
      if (!result.matchedCount) throw new Error("El inventario cambió. Vuelve a intentarlo.");
    } else { variant.stock = after; (variant as typeof variant & { lots: StockLot[] }).lots = lots.filter((l) => l.quantity > 0); (product as DemoRecord).priceRange = sellablePriceRange(product.variants); }
    let running = before;
    for (const part of allocation) {
      const change = delta < 0 ? -part.quantity : part.quantity;
      await recordMovement({ productId, sku, title: product.title, delta: change, before: running, after: running + change, warehouseId: part.warehouseId, lot: part.lot, expiresOn: part.expiresOn, unitCost: part.unitCost, reason: options.reason });
      running += change;
    }
    return allocation;
  }

  async slugExists(slug: string, exceptId?: string) { return this.useMongo ? Boolean(await ProductModel.exists({ slug, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })) : this.demo.some((p) => p.slug === slug && p.id !== exceptId); }

  async byGoal(goalSlug: string, limit = 8) {
    const safeLimit = Math.min(Math.max(limit, 1), 24);
    if (this.useMongo) return ProductModel.find({ "goals.slug": goalSlug, active: true }).sort({ featured: -1, createdAt: -1 }).limit(safeLimit).lean();
    return this.demo.filter((product) => product.active && product.goals.some((goal) => goal.slug === goalSlug)).slice(0, safeLimit);
  }

  async get(id: string) {
    if (this.useMongo) {
      if (!mongoose.isValidObjectId(id)) return null;
      return ProductModel.findById(id).lean();
    }
    return this.demo.find((product) => product.id === id) ?? null;
  }

  /**
   * Producto que un cliente puede ver y comprar. Un producto archivado sale del
   * catalogo, asi que tampoco debe poder cotizarse ni pedirse. Los documentos
   * antiguos sin el campo `active` se consideran vendibles.
   */
  async getSellable(id: string) {
    const product = await this.get(id);
    if (!product) return null;
    return (product as { active?: boolean }).active === false ? null : product;
  }

  /**
   * Marca o quita un producto de «Destacados» sin reenviar la ficha completa.
   * La revision evita pisar una edicion hecha por otra persona.
   */
  async setFeatured(id: string, featured: boolean, expectedRevision: number) {
    const stale = () => new Error("Otra persona modificó este producto. Actualiza la lista y vuelve a intentarlo.");
    if (this.useMongo) {
      if (!mongoose.isValidObjectId(id)) throw new Error("Producto no encontrado");
      const query = { _id: id, ...(expectedRevision === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision: expectedRevision }) };
      const updated = await ProductModel.findOneAndUpdate(query, { $set: { featured }, $inc: { revision: 1 } }, { new: true }).lean();
      if (!updated) throw (await ProductModel.exists({ _id: id })) ? stale() : new Error("Producto no encontrado");
      return updated;
    }
    const product = this.demo.find((candidate) => candidate.id === id);
    if (!product) throw new Error("Producto no encontrado");
    if ((product.revision ?? 0) !== expectedRevision) throw stale();
    product.featured = featured;
    product.revision = (product.revision ?? 0) + 1;
    return product;
  }

  /** Igual que getSellable, por el slug publico que usa la URL de la tienda. */
  async getSellableBySlug(slug: string) {
    const product = this.useMongo ? await ProductModel.findOne({ slug }).lean() : this.demo.find((candidate) => candidate.slug === slug) ?? null;
    if (!product) return null;
    return (product as { active?: boolean }).active === false ? null : product;
  }

  async catalogBrands() {
    if (this.useMongo) return (await ProductModel.distinct("brand", { active: true })).sort();
    return [...new Set(this.demo.filter(product => product.active).map(product => product.brand))].sort();
  }

  /** Tipos de producto (categorías) con productos activos y cuántos hay de cada uno (C65, V16). */
  async catalogCategories(): Promise<Array<{ slug: string; name: string; count: number }>> {
    const rows = this.useMongo
      ? await ProductModel.aggregate<{ _id: string; name: string; count: number }>([{ $match: { active: true } }, { $unwind: "$categories" }, { $group: { _id: "$categories.slug", name: { $first: "$categories.name" }, count: { $sum: 1 } } }])
      : [...this.demo.filter(product => product.active).flatMap(product => product.categories).reduce((map, category) => map.set(category.slug, { _id: category.slug, name: category.name, count: (map.get(category.slug)?.count ?? 0) + 1 }), new Map<string, { _id: string; name: string; count: number }>()).values()];
    return rows.map(row => ({ slug: row._id, name: row.name, count: row.count })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  async search(filters: SearchFilters = {}, pagination: { first?: number; after?: string } = {}) {
    const first = Math.min(Math.max(pagination.first ?? 12, 1), 100);
    const cursor = decodeCursor(pagination.after);
    let afterId = cursor;
    let afterPrice: number | undefined;
    if (filters.sort && cursor) {
      try {
        const parsed = JSON.parse(cursor);
        if (typeof parsed.id !== "string" || !Number.isFinite(parsed.price)) throw new Error();
        afterId = parsed.id; afterPrice = parsed.price;
      } catch { throw new Error("La página cambió. Vuelve al inicio del catálogo."); }
    }
    const direction = filters.sort === "PRICE_DESC" ? -1 : 1;
    const cursorFor = (id: string, price: number) => encodeCursor(filters.sort ? JSON.stringify({ id, price }) : id);

    if (this.useMongo) {
      const query: Record<string, unknown> = {};
      if ((filters.status ?? "ACTIVE") !== "ALL") query.active = filters.status !== "ARCHIVED";
      if (filters.search) {
        const { words, sizes } = searchTerms(filters.search);
        const all = [
          ...words.map(word => { const pattern = new RegExp(wordAlternatives(word).map(searchPattern).join("|"), "i"); return { $or: searchFields.map(field => ({ [field]: pattern })) }; }),
          ...sizes.map(size => ({ variants: { $elemMatch: { "size.value": size.value, "size.unit": size.unit } } }))
        ];
        if (all.length) query.$and = all;
      }
      if (filters.brands?.length) query.brand = { $in: filters.brands.map((brand) => new RegExp(escapeRegex(brand), "i")) };
      if (filters.goals?.length) query["goals.slug"] = { $in: filters.goals };
      if (filters.categories?.length) query["categories.slug"] = { $in: filters.categories };
      if (filters.flavors?.length) query["variants.flavor"] = { $in: filters.flavors };
      if (filters.inStock) query["variants.stock"] = { $gt: 0 };
      if (filters.featured) query.featured = true;
      if (filters.minPrice !== undefined || filters.maxPrice !== undefined) query["priceRange.min"] = {
        ...(filters.minPrice !== undefined ? { $gte: filters.minPrice } : {}),
        ...(filters.maxPrice !== undefined ? { $lte: filters.maxPrice } : {})
      };
      const totalCount = await ProductModel.countDocuments(query);
      if (afterId && mongoose.isValidObjectId(afterId)) {
        // Se suma a las condiciones de la búsqueda (C47): no las reemplaza.
        if (filters.sort && afterPrice !== undefined) query.$and = [...((query.$and as unknown[] | undefined) ?? []), { $or: [
          { "priceRange.min": { [direction === 1 ? "$gt" : "$lt"]: afterPrice } },
          { "priceRange.min": afterPrice, _id: { $gt: afterId } }
        ] }];
        else query._id = { $gt: afterId };
      }
      const order: Record<string, 1 | -1> = filters.sort ? { "priceRange.min": direction, _id: 1 } : { _id: 1 };
      const rows = await ProductModel.find(query).sort(order).limit(first + 1).lean();
      const hasNextPage = rows.length > first;
      const page = rows.slice(0, first);
      return {
        edges: page.map((node) => ({ cursor: cursorFor(String(node._id), node.priceRange!.min!), node })),
        pageInfo: { endCursor: page.length ? cursorFor(String(page.at(-1)!._id), page.at(-1)!.priceRange!.min!) : null, hasNextPage },
        totalCount
      };
    }

    const status = filters.status ?? "ACTIVE";
    const filtered = this.demo.filter((product) => {
      const terms = filters.search ? searchTerms(filters.search) : { words: [], sizes: [] };
      const haystack = terms.words.length ? normalizeSearch(`${product.title} ${product.brand} ${product.shortDescription} ${product.variants.map((v) => `${v.sku} ${v.flavor}`).join(" ")} ${product.categories.map(c => c.name).join(" ")} ${product.goals.map(g => g.name).join(" ")}`) : "";
      return (status === "ALL" || product.active === (status === "ACTIVE"))
        && terms.words.every(word => wordAlternatives(word).some(alternative => haystack.includes(alternative)))
        && terms.sizes.every(size => product.variants.some(v => v.size.value === size.value && v.size.unit === size.unit))
        && (!filters.brands?.length || filters.brands.some((brand) => product.brand.toLocaleLowerCase().includes(brand.toLocaleLowerCase())))
        && (!filters.goals?.length || product.goals.some((goal) => filters.goals!.includes(goal.slug)))
        && (!filters.categories?.length || product.categories.some((category) => filters.categories!.includes(category.slug)))
        && (!filters.flavors?.length || product.variants.some((variant) => filters.flavors!.includes(variant.flavor)))
        && (!filters.inStock || product.variants.some(variant => variant.stock > 0))
        && (!filters.featured || product.featured === true)
        && (filters.minPrice === undefined || product.priceRange.min >= filters.minPrice)
        && (filters.maxPrice === undefined || product.priceRange.min <= filters.maxPrice);
    });
    if (filters.sort) filtered.sort((a, b) => direction * (a.priceRange.min - b.priceRange.min) || a.id.localeCompare(b.id));
    const start = afterId ? Math.max(0, filtered.findIndex((product) => product.id === afterId) + 1) : 0;
    const page = filtered.slice(start, start + first);
    return {
      edges: page.map((node) => ({ cursor: cursorFor(node.id, node.priceRange.min), node })),
      pageInfo: { endCursor: page.length ? cursorFor(page.at(-1)!.id, page.at(-1)!.priceRange.min) : null, hasNextPage: start + first < filtered.length },
      totalCount: filtered.length
    };
  }

  async upsert(id: string | undefined, rawPayload: unknown, expectedStocks?: Array<{ sku: string; stock: number }>, expectedRevision?: number): Promise<unknown> {
    if (!operationContext.getStore()) return unitOfWork(() => this.upsert(id, rawPayload, expectedStocks, expectedRevision));
    const payload = productPayloadSchema.parse(rawPayload);
    if (await this.slugExists(payload.slug, id)) throw new Error("Ya existe un producto con ese identificador");
    if (id && expectedStocks) {
      const current = await this.get(id);
      if (!current || current.variants.length !== expectedStocks.length || current.variants.some((v) => !expectedStocks.some((old) => old.sku === v.sku && old.stock === v.stock))) throw new Error("El inventario cambió mientras editabas. Recarga el producto para conservar las ventas recientes.");
    }
    const old = id ? await this.get(id) : null;
    if (id && expectedRevision !== undefined && (old?.revision ?? 0) !== expectedRevision) throw new Error("Otra persona modificó esta ficha. Recarga antes de guardar; tus cambios siguen en el borrador.");
    if (old?.variants.some(v => v.stock > 0 && !payload.variants.some(next => next.sku === v.sku))) throw new Error("No puedes quitar ni cambiar el SKU de una variante con stock. Realiza primero un ajuste o conserva la variante.");
    const initialMovements = async (productId: string) => { for (const v of payload.variants) { if (!old?.variants.some(previous => previous.sku === v.sku)) await recordMovement({ productId, sku: v.sku, title: payload.title, delta: v.stock, before: 0, after: v.stock, warehouseId: "main", lot: "INICIAL", expiresOn: "", unitCost: null, reason: "Stock inicial de producto" }); } };
    const preserved: Array<typeof payload.variants[number] & { lots?: StockLot[] }> = [];
    for (const v of payload.variants) {
      const previous = old?.variants.find((x) => x.sku === v.sku);
      if (previous && previous.stock !== v.stock) await this.changeStock(id!, v.sku, v.stock - previous.stock, { reason: "Cambio desde ficha de producto", allowExpired: true });
      const refreshed = previous && id ? (await this.get(id))?.variants.find((x) => x.sku === v.sku) : null;
      preserved.push({ ...v, lots: refreshed ? normalizedLots(refreshed as unknown as { stock: number; lots?: StockLot[] }) : normalizedLots(v) });
    }
    const data = { ...payload, variants: preserved, nutritionalFacts: payload.productType === "APPAREL" ? undefined : payload.nutritionalFacts, priceRange: sellablePriceRange(preserved) };
    if (this.useMongo) {
      if (id) {
        const query = { _id: id, ...(expectedRevision === undefined ? {} : expectedRevision === 0 ? { $or: [{revision:0},{revision:{$exists:false}}] } : {revision:expectedRevision}), ...(expectedStocks ? { $and: [{ variants: { $size: expectedStocks.length } }, ...expectedStocks.map((v) => ({ variants: { $elemMatch: { sku: v.sku, stock: payload.variants.find((p) => p.sku === v.sku)?.stock ?? v.stock } } }))] } : {}) };
        const updated = await ProductModel.findOneAndUpdate(query, { $set: { ...data, nutritionalFacts: data.nutritionalFacts ?? null }, $inc: {revision:1} }, { new: true, runValidators: true }).lean();
        if (!updated) throw new Error("Producto inexistente o inventario modificado. Recarga antes de guardar.");
        await initialMovements(String(updated._id));
        return updated;
      }
      const created = await ProductModel.create(data);
      await initialMovements(String(created._id));
      return created;
    }
    if (id) {
      const index = this.demo.findIndex((product) => product.id === id);
      if (index < 0) throw new Error("Producto no encontrado");
      this.demo[index] = {...withDerivedFields({ ...payload, variants: preserved }, id, this.demo[index]!.active), revision:(old?.revision ?? 0)+1};
      await initialMovements(id);
      return this.demo[index];
    }
    const created = withDerivedFields({ ...payload, variants: preserved }, demoId());
    this.demo.unshift(created);
    await initialMovements(created.id);
    return created;
  }

  /**
   * Unión de productos (C49): las presentaciones del origen pasan al destino con su
   * stock, lotes, fotos y SKU (el sabor se puede renombrar). El origen queda archivado,
   * sin stock y con los SKU marcados «-UNIDO», para no contar dos veces el inventario.
   */
  async absorbVariants(sourceId: string, targetId: string, flavors: Record<string, string> = {}, revisions: { source?: number; target?: number } = {}): Promise<{ product: unknown; movedSkus: string[] }> {
    if (!operationContext.getStore()) return unitOfWork(() => this.absorbVariants(sourceId, targetId, flavors, revisions));
    if (sourceId === targetId) throw new Error("Elige dos productos distintos.");
    const source = await this.get(sourceId), target = await this.get(targetId);
    if (!source || !target) throw new Error("Producto no encontrado.");
    if (revisions.source !== undefined && (source.revision ?? 0) !== revisions.source) throw new Error("El producto que vas a unir cambió. Recarga antes de continuar.");
    if (revisions.target !== undefined && (target.revision ?? 0) !== revisions.target) throw new Error("El producto destino cambió. Recarga antes de continuar.");
    type Row = (typeof target.variants)[number] & { lots?: StockLot[] };
    const plain = (variant: Row) => ({ ...JSON.parse(JSON.stringify(variant)) as Row });
    // Fichas antiguas pueden traer fotos sin texto alternativo, que hoy es obligatorio: se describe con producto, sabor y tamaño.
    const moved = (source.variants as Row[]).map(variant => {
      const flavor = (flavors[variant.sku] ?? variant.flavor).trim();
      const images = (variant.images ?? []).map(image => ({ ...image, alt: image.alt?.trim() || `${target.title}, ${flavor}, ${variant.size.value} ${variant.size.unit}`.slice(0, 140) }));
      return { ...plain(variant), flavor, images, lots: normalizedLots(variant as unknown as { stock: number; lots?: StockLot[] }) };
    });
    const same = (a: Row, b: Row) => a.flavor.toLocaleLowerCase("es") === b.flavor.toLocaleLowerCase("es") && a.size.value === b.size.value && a.size.unit === b.size.unit;
    for (const [index, variant] of moved.entries()) {
      if (!variant.flavor) throw new Error(`Escribe el sabor de ${variant.sku}.`);
      if (target.variants.some(existing => existing.sku === variant.sku)) throw new Error(`El SKU ${variant.sku} ya está en «${target.title}».`);
      if ((target.variants as Row[]).some(existing => same(existing, variant)) || moved.some((other, i) => i < index && same(other, variant))) throw new Error(`«${target.title}» ya tendría ${variant.flavor} · ${variant.size.value} ${variant.size.unit}. Cambia el sabor antes de unir.`);
    }
    const variants = [...(target.variants as Row[]).map(plain), ...moved];
    const retired = moved.map(variant => ({ ...variant, sku: `${variant.sku}-UNIDO`.slice(0, 80), stock: 0, lots: [] }));
    const byRevision = (revision?: number) => revision ? { revision } : { $or: [{ revision: 0 }, { revision: { $exists: false } }] };
    let result: unknown;
    if (this.useMongo) {
      result = await ProductModel.findOneAndUpdate({ _id: targetId, ...byRevision(target.revision) }, { $set: { variants, priceRange: sellablePriceRange(variants) }, $inc: { revision: 1 } }, { new: true, runValidators: true }).lean();
      if (!result) throw new Error("El producto destino cambió. Recarga antes de continuar.");
      const changed = await ProductModel.updateOne({ _id: sourceId, ...byRevision(source.revision) }, { $set: { variants: retired, active: false, featured: false }, $inc: { revision: 1 } });
      if (!changed.matchedCount) throw new Error("El producto que vas a unir cambió. Recarga antes de continuar.");
    } else {
      const t = this.demo.findIndex(product => product.id === targetId), o = this.demo.findIndex(product => product.id === sourceId);
      this.demo[t] = { ...this.demo[t]!, variants: variants as DemoRecord["variants"], priceRange: sellablePriceRange(variants), revision: (this.demo[t]!.revision ?? 0) + 1 };
      this.demo[o] = { ...this.demo[o]!, variants: retired as DemoRecord["variants"], active: false, featured: false, revision: (this.demo[o]!.revision ?? 0) + 1 };
      result = this.demo[t];
    }
    // Movimientos: salida del origen y entrada al destino, lote por lote, con el mismo SKU.
    const reason = `Unión de «${source.title}» en «${target.title}»`;
    for (const variant of moved) {
      let left = variant.stock, arrived = 0;
      for (const lot of variant.lots ?? []) {
        if (!lot.quantity) continue;
        const base = { sku: variant.sku, warehouseId: lot.warehouseId, lot: lot.lot, expiresOn: lot.expiresOn, unitCost: lot.unitCost, reason };
        await recordMovement({ ...base, productId: sourceId, title: source.title, delta: -lot.quantity, before: left, after: left - lot.quantity }); left -= lot.quantity;
        await recordMovement({ ...base, productId: targetId, title: target.title, delta: lot.quantity, before: arrived, after: arrived + lot.quantity }); arrived += lot.quantity;
      }
    }
    return { product: result, movedSkus: moved.map(variant => variant.sku) };
  }

  async setActive(id: string, active: boolean) {
    if (this.useMongo) {
      if (!mongoose.isValidObjectId(id)) return null;
      return ProductModel.findByIdAndUpdate(id, { active }, { new: true }).lean();
    }
    const index = this.demo.findIndex((product) => product.id === id);
    if (index < 0) return null;
    this.demo[index]!.active = active;
    return this.demo[index];
  }

  async archive(id: string) {
    return Boolean(await this.setActive(id, false));
  }

  async restore(id: string) {
    const product = await this.setActive(id, true);
    if (!product) throw new Error("Producto no encontrado");
    return product;
  }

  /**
   * Categorias, objetivos y marcas que existen hoy en el catalogo, con cuantos
   * productos los usan. No son colecciones aparte: viven dentro de cada
   * producto, asi que se calculan agrupando.
   */
  async taxonomy(): Promise<TaxonomyOverview> {
    if (this.useMongo) {
      const group = async (path: "categories" | "goals") => {
        const rows = await ProductModel.aggregate<{ _id: string; name: string; productCount: number }>([
          { $match: { active: { $ne: false } } },
          { $unwind: `$${path}` },
          { $group: { _id: `$${path}.slug`, name: { $first: `$${path}.name` }, productCount: { $sum: 1 } } },
          { $sort: { productCount: -1, _id: 1 } }
        ]);
        return rows.map((row) => ({ key: row._id, name: row.name, productCount: row.productCount }));
      };
      const brandRows = await ProductModel.aggregate<{ _id: string; productCount: number }>([
        { $match: { active: { $ne: false } } },
        { $group: { _id: "$brand", productCount: { $sum: 1 } } },
        { $sort: { productCount: -1, _id: 1 } }
      ]);
      return {
        categories: await group("categories"),
        goals: await group("goals"),
        brands: brandRows.map((row) => ({ key: row._id, name: row._id, productCount: row.productCount }))
      };
    }

    const activos = this.demo.filter((product) => product.active !== false);
    const count = (pick: (product: DemoRecord) => Array<{ name: string; slug: string }>) => {
      const map = new Map<string, { key: string; name: string; productCount: number }>();
      for (const product of activos) {
        for (const entry of pick(product)) {
          const found = map.get(entry.slug);
          if (found) found.productCount += 1;
          else map.set(entry.slug, { key: entry.slug, name: entry.name, productCount: 1 });
        }
      }
      return [...map.values()].sort((a, b) => b.productCount - a.productCount || a.key.localeCompare(b.key));
    };
    const brands = new Map<string, number>();
    for (const product of activos) brands.set(product.brand, (brands.get(product.brand) ?? 0) + 1);
    return {
      categories: count((product) => product.categories),
      goals: count((product) => product.goals),
      brands: [...brands.entries()]
        .map(([key, productCount]) => ({ key, name: key, productCount }))
        .sort((a, b) => b.productCount - a.productCount || a.key.localeCompare(b.key))
    };
  }

  /**
   * Renombrar, fusionar o quitar una etiqueta en todo el catalogo de una vez.
   * El slug no cambia al renombrar: la tienda filtra por slug y cambiarlo
   * romperia los enlaces que ya circulan. Para unificar dos etiquetas se usa
   * la fusion, que es justamente mover los productos de una a la otra.
   */
  async editTaxonomy(kind: TaxonomyKind, action: TaxonomyAction, key: string, target: string) {
    if (kind === "BRAND") return this.editBrand(action, key, target);

    const path = kind === "CATEGORY" ? "categories" : "goals";
    const products = await this.productsWithTag(path, key);
    let changed = 0;

    for (const product of products) {
      const current = (product[path] ?? []) as Array<{ name: string; slug: string }>;
      let next: Array<{ name: string; slug: string }>;
      if (action === "RENAME") {
        next = current.map((entry) => entry.slug === key ? { ...entry, name: target } : entry);
      } else if (action === "REMOVE") {
        next = current.filter((entry) => entry.slug !== key);
      } else {
        const destino = current.find((entry) => entry.slug === target);
        const nombre = destino?.name ?? target;
        next = current.map((entry) => entry.slug === key ? { slug: target, name: nombre } : entry);
      }
      // Fusionar puede dejar la etiqueta destino dos veces en el mismo producto.
      const unique = next.filter((entry, index) => next.findIndex((other) => other.slug === entry.slug) === index);
      await this.writeTaxonomy(product, path, unique);
      changed += 1;
    }
    return changed;
  }

  private async editBrand(action: TaxonomyAction, key: string, target: string) {
    if (action === "REMOVE") throw new Error("La marca es obligatoria: renombrala o fusionala con otra");
    if (this.useMongo) {
      const result = await ProductModel.updateMany({ brand: key }, { $set: { brand: target }, $inc:{revision:1} });
      return result.modifiedCount;
    }
    let changed = 0;
    for (const product of this.demo) {
      if (product.brand !== key) continue;
      product.brand = target; product.revision++;
      changed += 1;
    }
    return changed;
  }

  private async productsWithTag(path: "categories" | "goals", key: string) {
    if (this.useMongo) return ProductModel.find({ [`${path}.slug`]: key }).lean();
    return this.demo.filter((product) => product[path].some((entry) => entry.slug === key));
  }

  private async writeTaxonomy(product: Record<string, unknown>, path: "categories" | "goals", value: Array<{ name: string; slug: string }>) {
    if (this.useMongo) {
      await ProductModel.updateOne({ _id: product._id }, { $set: { [path]: value }, $inc:{revision:1} });
      return;
    }
    const found = this.demo.find((candidate) => candidate.id === product.id);
    if (found) { found[path] = value; found.revision++; }
  }

  /** Totales reales del catalogo, no de la pagina que tenga cargada el panel. */
  async stats() {
    if (this.useMongo) {
      const [active, archived, featured, stockAggregate] = await Promise.all([
        ProductModel.countDocuments({ active: { $ne: false } }),
        ProductModel.countDocuments({ active: false }),
        ProductModel.countDocuments({ active: { $ne: false }, featured: true }),
        ProductModel.aggregate<{ stock: number }>([
          { $match: { active: { $ne: false } } },
          { $unwind: "$variants" },
          { $group: { _id: null, stock: { $sum: "$variants.stock" } } },
          { $project: { _id: 0, stock: 1 } }
        ])
      ]);
      return { active, archived, featured, stock: stockAggregate[0]?.stock ?? 0 };
    }
    const activos = this.demo.filter((product) => product.active !== false);
    return {
      active: activos.length,
      archived: this.demo.length - activos.length,
      featured: activos.filter((product) => product.featured).length,
      stock: activos.reduce((sum, product) => sum + product.variants.reduce((inner, variant) => inner + variant.stock, 0), 0)
    };
  }

  /**
   * Descuenta inventario de forma atomica. En Mongo la condicion `stock >= cantidad`
   * viaja dentro del propio update, asi que dos compras simultaneas de la ultima
   * unidad no pueden ganar las dos. Si una linea falla se devuelve lo ya tomado,
   * para no dejar la orden a medias.
   */
  async reserveStock(items: Array<{ productId: string; variantSku: string; quantity: number; allocations?: StockLot[] }>): Promise<void> {
    if (!operationContext.getStore()) return unitOfWork(() => this.reserveStock(items));
    for (const item of items) item.allocations = await this.changeStock(item.productId, item.variantSku, -item.quantity, { reason: "Reserva de pedido" });
  }

  async releaseStock(items: Array<{ productId: string; variantSku: string; quantity: number; allocations?: StockLot[] }>, reason = "Liberación de reserva de pedido"): Promise<void> {
    if (!operationContext.getStore()) return unitOfWork(() => this.releaseStock(items, reason));
    const warehouses = await supplyService.warehouses();
    for (const item of items) {
      const rerouted = item.allocations?.some(lot => !warehouses.some(w => w.id === lot.warehouseId && w.active));
      const lots = item.allocations?.map(lot => ({...lot, warehouseId: warehouses.some(w => w.id === lot.warehouseId && w.active) ? lot.warehouseId : "main"}));
      await this.changeStock(item.productId, item.variantSku, item.quantity, { exactLots: lots?.length ? lots : undefined, reason: rerouted ? `${reason}; destino principal por origen archivado` : reason });
    }
  }

  /** `settings` solo se pasa en pruebas; en uso normal se lee la configuración vigente. */
  async calculateCart(items: Array<{ productId: string; variantSku: string; quantity: number }>, shippingMethod?: ShippingMethod, settings?: CommerceSettings, discountCode?: string | null) {
    const rules = settings ?? await commerceSettingsService.get();
    const freeShippingThreshold = rules.freeShippingThreshold;
    let subtotal = 0;
    for (const item of items) {
      const product = this.useMongo
        ? await ProductModel.findOne({ _id: item.productId, "variants.sku": item.variantSku, active: { $ne: false } }).lean()
        : this.demo.find((candidate) => candidate.id === item.productId && candidate.active !== false && candidate.variants.some((variant) => variant.sku === item.variantSku));
      if (!product) throw new Error(`Variante no encontrada: ${item.variantSku}`);
      const variant = product.variants.find((candidate) => candidate.sku === item.variantSku);
      if (!variant || variant.stock < item.quantity) throw new Error(`Stock insuficiente: ${item.variantSku}`);
      subtotal += Math.round(variant.price * item.quantity * 100) / 100;
    }
    subtotal = Math.round(subtotal * 100) / 100;
    // Código de bienvenida (C46): aquí solo se valida el código; la primera compra se comprueba al crear el pedido.
    const offer = evaluateCode(rules, discountCode, subtotal);
    const discount = offer.discount?.amount ?? 0;
    const productsTotal = Math.round((subtotal - discount) * 100) / 100;
    const amountUntilFreeShipping = Math.max(0, Math.round((freeShippingThreshold - productsTotal) * 100) / 100);
    const shippingFee = shippingMethod ? feeFor(rules, shippingMethod, productsTotal) : 0;
    // Sin método elegido: gratis si algún método lo sería; con método: solo si ese método lo es.
    const freeEligible = shippingMethod ? rules.freeShippingMethods.includes(shippingMethod) : rules.freeShippingMethods.length > 0;
    return {
      subtotal,
      discount,
      discountCode: offer.discount?.code ?? null,
      discountPercent: offer.discount?.percent ?? null,
      discountMessage: offer.message,
      shippingFee,
      total: Number((productsTotal + shippingFee).toFixed(2)),
      earnedCoins: 0, // retirado en C67; se conserva en el esquema por compatibilidad
      freeShippingThreshold,
      amountUntilFreeShipping,
      hasFreeShipping: freeEligible && amountUntilFreeShipping === 0
    };
  }
}

export const productService = new ProductService();
