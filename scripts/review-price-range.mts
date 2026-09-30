// P08 sobre MongoDB real: el rango de precio vendible se actualiza en la misma
// transacción que el stock y se corrige al arrancar en productos antiguos.
// Uso (réplica temporal): node scripts/review-transactions-local.mjs scripts/review-price-range.mts
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const uri = process.env.AUDIT_MONGODB_URI;
if (!uri || !/replicaSet=/.test(uri) || !/rawenergy_audit_/.test(uri)) throw new Error("AUDIT_MONGODB_URI debe apuntar a una base temporal rawenergy_audit_* con replicaSet.");
const { productService } = await import("../apps/api/src/services/product.service.ts");
const { ProductModel } = await import("../apps/api/src/models/Product.ts");
const { supplyService } = await import("../apps/api/src/services/supply.service.ts");
const { demoProducts } = await import("../apps/api/src/data/demoProducts.ts");
const { unitOfWork } = await import("../apps/api/src/lib/unitOfWork.ts");
const mongoose = (await import("mongoose")).default;

const checks: string[] = [];
await productService.connect(uri);
try {
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  await supplyService.bootstrap();
  const base = demoProducts[1]!;
  const variant = (sku: string, price: number, stock: number) => ({ ...base.variants[0]!, sku, flavor: sku, price, stock });
  const payload = { ...base, slug: "rango-mongo", featured: false, variants: [variant("MG-BARATA", 21.5, 0), variant("MG-MEDIA", 38.25, 3), variant("MG-CARA", 52, 2)] };
  const created = await productService.upsert(undefined, payload) as { _id: unknown };
  const id = String(created._id);
  const range = async () => { const row = await ProductModel.findById(id).lean(); return { min: row!.priceRange!.min, max: row!.priceRange!.max }; };

  assert.deepEqual(await range(), { min: 38.25, max: 52 }); checks.push("Alta con la barata agotada: desde 38,25");
  const listed = async (minPrice: number, maxPrice: number) => (await productService.search({ minPrice, maxPrice }, { first: 50 })).edges.some(edge => String((edge.node as { _id?: unknown })._id) === id);
  assert.equal(await listed(20, 22), false); assert.equal(await listed(38, 39), true); checks.push("Filtro de precio en MongoDB usa el rango vendible");

  await productService.changeStock(id, "MG-BARATA", 4, { reason: "Reposición de prueba" });
  assert.deepEqual(await range(), { min: 21.5, max: 52 }); assert.equal(await listed(20, 22), true); checks.push("Reposición de la barata: vuelve a desde 21,50");

  await assert.rejects(unitOfWork(async () => { await productService.changeStock(id, "MG-BARATA", -4, { reason: "Venta que falla" }); throw new Error("fallo posterior"); }), /fallo posterior/);
  assert.deepEqual(await range(), { min: 21.5, max: 52 }); checks.push("Transacción revertida conserva stock y rango");

  await Promise.allSettled([
    productService.changeStock(id, "MG-BARATA", -4, { reason: "Venta concurrente" }),
    productService.changeStock(id, "MG-CARA", -2, { reason: "Venta concurrente" })
  ]);
  const row = await ProductModel.findById(id).lean();
  const expected = (await import("../apps/api/src/lib/priceRange.ts")).sellablePriceRange(row!.variants);
  assert.deepEqual(await range(), expected); checks.push(`Dos ventas simultáneas de variantes distintas: rango coherente con el stock final (${JSON.stringify(expected)})`);

  await ProductModel.updateOne({ _id: id }, { $set: { priceRange: { min: 1, max: 999 } } });
  assert.equal(await productService.refreshPriceRanges(), 1);
  assert.deepEqual(await range(), expected); assert.equal(await productService.refreshPriceRanges(), 0); checks.push("Arranque corrige un rango antiguo y la segunda pasada no cambia nada");

  await mongoose.connection.db!.dropDatabase();
  console.log(JSON.stringify({ ok: true, checks }));
  if (process.env.AUDIT_REPORT_PATH) await writeFile(process.env.AUDIT_REPORT_PATH, JSON.stringify({ ok: true, mongo: (await mongoose.connection.db!.admin().serverInfo()).version, checks, limits: ["Réplica de un nodo", "Sin varias instancias de API"] }, null, 2));
} finally { await productService.disconnect(); }
