// IMPL-BASE-01 (M36) sobre MongoDB real: compras, capas de inventario (M40/M46), idempotencia
// (M35), índices (M45) y dinero documental (M05). Base temporal aislada, se elimina al terminar.
// Uso: node scripts/review-transactions-local.mjs scripts/review-purchases-real.mts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import { productService } from "../apps/api/src/services/product.service.js";
import { orderService } from "../apps/api/src/services/order.service.js";
import { supplyService } from "../apps/api/src/services/supply.service.js";
import { mailService } from "../apps/api/src/services/mail.service.js";
import { telegramService } from "../apps/api/src/services/telegram.service.js";
import { ProductModel } from "../apps/api/src/models/Product.js";
import { OrderModel } from "../apps/api/src/models/Order.js";
import { MovementModel, PurchaseModel } from "../apps/api/src/models/Supply.js";
import { demoProducts } from "../apps/api/src/data/demoProducts.js";
import { ensureIndexes } from "../apps/api/src/lib/indexes.js";
import { readFileSync } from "node:fs";
import { purchaseImportService } from "../apps/api/src/services/purchaseImport.service.js";
import { PurchaseImportModel, SupplierAliasModel } from "../apps/api/src/models/PurchaseImport.js";
import { exchangeService, ExchangeModel } from "../apps/api/src/services/exchange.service.js";

const uri = process.env.AUDIT_MONGODB_URI ?? "";
assert(/^mongodb:\/\/127\.0\.0\.1:\d+\/rawenergy_audit_[a-f0-9]+\?replicaSet=audit&directConnection=true$/.test(uri), "Solo se admite la DB aislada creada por el lanzador");
mailService.sendOrderConfirmation = async () => true;
mailService.sendOperatorAlert = async () => true;
mailService.sendStatusUpdate = async () => true;
telegramService.sendOrderAlert = async () => true;
const checks: string[] = [];
const ok = (text: string) => { checks.push(text); console.log(`✓ ${text}`); };
const ec = (days = 0) => new Date(Date.now() - 5 * 3600000 - days * 86400000).toISOString().slice(0, 10);
const customer = { fullName: "Revisión aislada", email: "compras@example.test", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Dirección ficticia 123", idNumber: "1700000001", reference: "" };

async function fixture(stock = 0) {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `compras-${randomUUID()}`; payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), stock }];
  const product = await productService.upsert(undefined, payload) as { _id?: unknown; id?: string };
  const supplier = await supplyService.saveSupplier(undefined, { name: `Proveedor ${randomUUID().slice(0, 6)}` });
  return { productId: String(product._id ?? product.id), sku: payload.variants[0]!.sku, supplierId: supplier.id };
}
async function ordered(f: Awaited<ReturnType<typeof fixture>>, quantity: number, extra: Record<string, unknown> = {}) {
  const draft = await supplyService.savePurchase(undefined, { supplierId: f.supplierId, warehouseId: "main", items: [{ productId: f.productId, sku: f.sku, quantity, unitCost: 12, lot: "LOTE-R", expiresOn: "2090-01-01" }], ...extra });
  return supplyService.changePurchase(draft.id, "ORDERED", draft.revision);
}
const rawLots = async (productId: string) => ((await ProductModel.findById(productId).lean())?.variants[0]?.lots ?? []) as Array<Record<string, unknown>>;

try {
  await productService.connect(uri);
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  await supplyService.bootstrap();

  // M40/M46: dos recepciones iguales quedan como capas separadas y persistidas.
  const f = await fixture();
  const first = await ordered(f, 3); await supplyService.changePurchase(first.id, "RECEIVED", first.revision, ec(15));
  const second = await ordered(f, 2); await supplyService.changePurchase(second.id, "RECEIVED", second.revision);
  const lots = await rawLots(f.productId);
  assert.equal(lots.length, 2);
  assert.deepEqual(lots.map(l => [l.layerId, l.receivedOn, l.purchaseId, l.source]).sort(), [[`P-${first.id}-0`, ec(15), first.id, "PURCHASE"], [`P-${second.id}-0`, ec(), second.id, "PURCHASE"]].sort());
  ok("Dos recepciones con igual lote, vencimiento y costo se guardan como dos capas con fecha efectiva y compra");

  // Recepción concurrente: una sola entrada.
  const g = await fixture();
  const race = await ordered(g, 4);
  const results = await Promise.allSettled([supplyService.changePurchase(race.id, "RECEIVED", race.revision), supplyService.changePurchase(race.id, "RECEIVED", race.revision)]);
  assert(results.some(r => r.status === "fulfilled"));
  assert.equal((await ProductModel.findById(g.productId).lean())?.variants[0]?.stock, 4);
  assert.equal(await MovementModel.countDocuments({ purchaseId: race.id }), 1);
  ok("Dos recepciones simultáneas de la misma compra suman una sola vez en MongoDB real");

  // Reversión: un fallo en la segunda línea deja la compra sin recibir y sin capas ni movimientos.
  const h = await fixture(), h2 = await fixture();
  const draft = await supplyService.savePurchase(undefined, { supplierId: h.supplierId, warehouseId: "main", items: [{ productId: h.productId, sku: h.sku, quantity: 2, unitCost: 5, lot: "A", expiresOn: "2090-01-01" }, { productId: h2.productId, sku: h2.sku, quantity: 1, unitCost: 5, lot: "B", expiresOn: "2090-01-01" }] });
  const pending = await supplyService.changePurchase(draft.id, "ORDERED", draft.revision);
  const original = productService.changeStock.bind(productService); let calls = 0;
  productService.changeStock = (async (...args: Parameters<typeof original>) => { if (++calls === 2) throw new Error("fallo inyectado"); return original(...args); }) as typeof original;
  await assert.rejects(supplyService.changePurchase(pending.id, "RECEIVED", pending.revision), /fallo inyectado/);
  productService.changeStock = original;
  assert.equal((await PurchaseModel.findById(pending.id).lean())?.status, "ORDERED");
  assert.equal((await rawLots(h.productId)).length, 0);
  assert.equal(await MovementModel.countDocuments({ purchaseId: pending.id }), 0);
  ok("Un fallo a mitad de la recepción revierte capas, stock, movimientos y estado");

  // Reserva y cancelación: asignaciones con capa y origen, y retorno a la misma capa.
  const order = await orderService.create({ idempotencyKey: randomUUID(), customer, items: [{ productId: f.productId, variantSku: f.sku, quantity: 4 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" }) as { _id: unknown };
  const stored = await orderService.get(String(order._id));
  assert.deepEqual(stored?.items[0]?.allocations?.map(a => [a.purchaseId, a.quantity]), [[first.id, 3], [second.id, 1]]);
  await orderService.updateStatus(String(order._id), "CANCELLED");
  const back = await rawLots(f.productId);
  assert.equal(back.length, 2);
  assert.equal(back.find(l => l.purchaseId === first.id)?.receivedOn, ec(15));
  ok("La venta toma primero la capa más antigua, guarda su compra de origen y al cancelar vuelve a la misma capa");

  // Traslado: conserva capa y fecha en la bodega destino.
  const target = await supplyService.saveWarehouse(undefined, { name: `Destino ${randomUUID().slice(0, 6)}` });
  await supplyService.transfer({ productId: f.productId, sku: f.sku, from: "main", to: target.id, lot: "LOTE-R", layerId: `P-${first.id}-0`, quantity: 2, reason: "Reubicación de prueba" });
  const moved = (await rawLots(f.productId)).find(l => l.warehouseId === target.id);
  assert.equal(moved?.receivedOn, ec(15)); assert.equal(moved?.layerId, `P-${first.id}-0`);
  ok("Un traslado conserva capa y fecha efectiva");

  // Saldos antiguos sin capa: identidad derivada y persistida al primer cambio, sin fecha inventada.
  const legacy = await fixture();
  await ProductModel.updateOne({ _id: legacy.productId }, { $set: { "variants.0.stock": 3, "variants.0.lots": [{ warehouseId: "main", lot: "VIEJO", expiresOn: "2090-01-01", quantity: 3, unitCost: 9 }] } });
  const legacyOrder = await orderService.create({ idempotencyKey: randomUUID(), customer, items: [{ productId: legacy.productId, variantSku: legacy.sku, quantity: 1 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" }) as { _id: unknown };
  await orderService.updateStatus(String(legacyOrder._id), "CANCELLED");
  const legacyLots = await rawLots(legacy.productId);
  assert.equal(legacyLots.length, 1); assert.equal(legacyLots[0]?.quantity, 3); assert.equal(legacyLots[0]?.receivedOn, ""); assert.equal(legacyLots[0]?.source, "LEGACY");
  assert.match(String(legacyLots[0]?.layerId), /^L-/);
  ok("Un lote anterior sin capa recibe identidad estable, sin fecha inventada, y no se fragmenta al reservar y liberar");

  // M41: con una reserva activa, físicas = sin reservar + reservadas y lo sin reservar coincide con la variante.
  await orderService.create({ idempotencyKey: randomUUID(), customer, items: [{ productId: f.productId, variantSku: f.sku, quantity: 2 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" });
  const rows = (await supplyService.positions()).filter(p => p.productId === f.productId);
  for (const row of rows) assert.equal(row.onHand, row.available + row.reserved);
  assert.equal(rows.reduce((s, r) => s + r.available, 0), (await ProductModel.findById(f.productId).lean())?.variants[0]?.stock);
  assert.equal(rows.reduce((s, r) => s + r.reserved, 0), 2); assert.equal(rows.reduce((s, r) => s + r.onHand, 0), 5);
  ok("Con reservas activas, cada capa cumple físicas = sin reservar + reservadas en MongoDB real");

  // M35: dos altas simultáneas con la misma clave crean una sola compra (índice único + reintento).
  const k = await fixture();
  const body = { supplierId: k.supplierId, warehouseId: "main", items: [{ productId: k.productId, sku: k.sku, quantity: 1, unitCost: 3, lot: "K", expiresOn: "2090-01-01" }] };
  const racing = await Promise.all([1, 2, 3].map(() => supplyService.savePurchase(undefined, structuredClone(body), undefined, { key: "misma-clave-real", actorId: "asistente" })));
  assert.equal(new Set(racing.map(p => p.id)).size, 1);
  assert.equal(await PurchaseModel.countDocuments({ supplierId: k.supplierId }), 1);
  await assert.rejects(supplyService.savePurchase(undefined, { ...body, notes: "otro contenido" }, undefined, { key: "misma-clave-real", actorId: "asistente" }), /otros datos/);
  const indexes = await PurchaseModel.collection.indexes();
  assert(indexes.some(i => i.key.requestKey === 1 && i.unique));
  ok("Tres altas simultáneas con la misma clave crean una sola compra; otra carga con esa clave se rechaza; índice único presente");

  // M05: factura FITLAB como caso fijo en MongoDB real (datos de prueba; no es la compra real).
  const fit = await fixture();
  const fitLines: Array<[number, string, string]> = [[4, "34.000000", "136.00"], [4, "21.756521", "87.03"], [1, "21.078261", "21.08"], [2, "21.756522", "43.51"], [1, "30.434783", "30.43"], [2, "10.234783", "20.47"], [2, "19.043478", "38.09"], [12, "1.417391", "17.01"], [2, "8.165217", "16.33"], [1, "21.739130", "21.74"]];
  const invoice = { supplierId: fit.supplierId, warehouseId: "main", document: { supplierTaxId: "1793213242001", number: "002-100-000004199", issuedOn: "2026-10-13", accessKey: "1310202601179321324200120021000000041991234567812", subtotal: "431.69", tax: "64.75", total: "496.44" }, items: fitLines.map(([quantity, netUnitCost, netTotal], i) => ({ productId: fit.productId, sku: fit.sku, quantity, netUnitCost, netTotal, taxRate: 15, lot: `F-${i}`, expiresOn: "2090-01-01" })) };
  const twice = await Promise.allSettled([supplyService.savePurchase(undefined, invoice, undefined, { key: "factura-persona-a", actorId: "a" }), supplyService.savePurchase(undefined, invoice, undefined, { key: "factura-persona-b", actorId: "b" })]);
  assert.equal(twice.filter(r => r.status === "fulfilled").length, 1);
  const loser = twice.find(r => r.status === "rejected") as PromiseRejectedResult;
  assert.match(String(loser.reason?.message), /ya está registrada/);
  const storedInvoice = await PurchaseModel.findOne({ documentKey: "1793213242001:FACTURA:002-100-000004199" }).lean();
  assert.equal(storedInvoice?.total, 496.44); assert.equal(storedInvoice?.calculatedTotal, 496.44);
  assert.deepEqual(storedInvoice?.items.map(i => i.unitCost), [39.1, 25.02, 24.24, 25.02, 35, 11.77, 21.9, 1.63, 9.39, 25]);
  assert.equal(storedInvoice?.items[1]?.netUnitCost, "21.756521");
  ok("Factura de prueba FITLAB: total 496,44, costos con IVA y seis decimales guardados; dos registros simultáneos dejan una sola compra y el otro recibe un mensaje claro");

  // M36: fallos del commit con puntos de fallo reales de MongoDB (requiere MONGO_TEST_COMMANDS=1).
  const limits: string[] = [];
  if (process.env.MONGO_TEST_COMMANDS === "1") {
    const admin = mongoose.connection.db!.admin();
    const failOnce = (data: Record<string, unknown>) => admin.command({ configureFailPoint: "failCommand", mode: { times: 1 }, data });
    const scenarios: Array<[string, Record<string, unknown>]> = [
      ["commit con resultado incierto", { failCommands: ["commitTransaction"], errorCode: 91, errorLabels: ["UnknownTransactionCommitResult"] }],
      ["conexión cortada durante el commit", { failCommands: ["commitTransaction"], closeConnection: true }],
      ["conflicto transitorio al escribir el movimiento", { failCommands: ["insert"], errorCode: 112, errorLabels: ["TransientTransactionError"] }]
    ];
    for (const [label, data] of scenarios) {
      const p = await fixture(); const purchase = await ordered(p, 3);
      await failOnce(data);
      let entered = 0;
      try { await supplyService.changePurchase(purchase.id, "RECEIVED", purchase.revision); }
      finally { entered = Number((await admin.command({ configureFailPoint: "failCommand", mode: "off" })).count ?? 0); }
      assert(entered >= 1, `El punto de fallo no se activó: ${label}`);
      assert.equal((await ProductModel.findById(p.productId).lean())?.variants[0]?.stock, 3, label);
      assert.equal(await MovementModel.countDocuments({ purchaseId: purchase.id }), 1, label);
      assert.equal((await PurchaseModel.findById(purchase.id).lean())?.status, "RECEIVED", label);
      ok(`Recepción con ${label}: el controlador reintenta y la mercadería entra una sola vez`);
    }
  } else limits.push("Puntos de fallo de MongoDB no activados: ejecutar con MONGO_TEST_COMMANDS=1 para probar commits inciertos");

  // M36: respuesta perdida tras recibir. El reintento con la revisión anterior devuelve la compra sin sumar otra vez.
  const lost = await fixture(); const lostPurchase = await ordered(lost, 2);
  await supplyService.changePurchase(lostPurchase.id, "RECEIVED", lostPurchase.revision);
  const again = await supplyService.changePurchase(lostPurchase.id, "RECEIVED", lostPurchase.revision);
  assert.equal(again.status, "RECEIVED");
  assert.equal((await ProductModel.findById(lost.productId).lean())?.variants[0]?.stock, 2);
  assert.equal(await MovementModel.countDocuments({ purchaseId: lostPurchase.id }), 1);
  ok("Repetir la recepción tras perder la respuesta devuelve la compra recibida sin sumar stock otra vez");

  // IMP-01: la misma factura subida y aprobada a la vez deja una sola importación y una sola compra en borrador.
  const fixtureItems = JSON.parse(readFileSync(new URL("../apps/api/src/services/fixtures/fitlab-factura-items.json", import.meta.url), "utf8")).items;
  const imported = await fixture();
  const importer = { id: "jefa", name: "Jefa de tienda" };
  const uploads = await Promise.all([1, 2].map(() => purchaseImportService.ingest("e".repeat(64), Buffer.from("%PDF-real"), { pages: [structuredClone(fixtureItems)] }, importer)));
  assert.equal(new Set(uploads.map(u => u.record.id)).size, 1);
  assert.equal(await PurchaseImportModel.countDocuments({ fileHash: "e".repeat(64) }), 1);
  const imp = uploads[0]!.record;
  // La factura FITLAB de prueba ya se registró arriba con el mismo número: se reconoce como duplicada.
  assert(imp.exceptions.some(e => e.code === "DUPLICADA"));
  const fresh = fixtureItems.map((i: { str: string }) => i.str === "002-100-000004199" ? { ...i, str: "002-100-000009001" } : /^\d{49}$/.test(i.str) ? { ...i, str: "x" } : i);
  const other = (await purchaseImportService.ingest("f".repeat(64), Buffer.from("%PDF-otra"), { pages: [fresh] }, importer)).record;
  const lines = other.lines.map(l => ({ index: l.index, productId: imported.productId, sku: imported.sku, expiresOn: "2090-01-01" }));
  const approvals = await Promise.allSettled([1, 2].map(() => purchaseImportService.approve(other.id, other.revision, { lines }, importer)));
  const purchaseIds = new Set(approvals.flatMap(a => a.status === "fulfilled" ? [a.value.purchaseId] : []));
  assert.equal(purchaseIds.size, 1, JSON.stringify(approvals.map(a => a.status === "rejected" ? String(a.reason) : "ok")));
  assert.equal(await PurchaseModel.countDocuments({ documentKey: "1793213242001:FACTURA:002-100-000009001" }), 1);
  assert.equal((await PurchaseModel.findOne({ documentKey: "1793213242001:FACTURA:002-100-000009001" }).lean())?.status, "DRAFT");
  assert.equal(await SupplierAliasModel.countDocuments({ supplierTaxId: "1793213242001" }), 10);
  ok("Importación: dos subidas del mismo PDF dejan una importación; dos aprobaciones simultáneas, una compra en borrador y 10 equivalencias");

  // CMB-01: dos generaciones simultáneas con la misma clave descuentan una vez; anular devuelve a la misma capa.
  const ex = await fixture();
  const exPurchase = await ordered(ex, 5); await supplyService.changePurchase(exPurchase.id, "RECEIVED", exPurchase.revision, ec(150));
  const exLayer = (await rawLots(ex.productId))[0]!;
  const exInput = { supplierId: ex.supplierId, sealedConfirmed: true, lines: [{ productId: ex.productId, sku: ex.sku, warehouseId: "main", layerId: String(exLayer.layerId), quantity: 3 }] };
  const generated = await Promise.all([1, 2].map(() => exchangeService.generate(structuredClone(exInput), "cambio-real-1", { id: "jefa", name: "Jefa" })));
  assert.equal(new Set(generated.map(g => g.id)).size, 1);
  assert.equal(await ExchangeModel.countDocuments({ supplierId: ex.supplierId }), 1);
  assert.equal((await ProductModel.findById(ex.productId).lean())?.variants[0]?.stock, 2);
  const voidedExchange = await exchangeService.void(generated[0]!.id, generated[0]!.revision, "El proveedor no aceptó");
  assert.equal(voidedExchange.status, "ANULADO");
  const backLots = await rawLots(ex.productId);
  assert.equal(backLots.length, 1); assert.equal(backLots[0]?.quantity, 5); assert.equal(backLots[0]?.receivedOn, ec(150));
  ok("Cambios: dos generaciones simultáneas con la misma clave descuentan una vez; anular devuelve las unidades a su recepción con su fecha");

  // M43: dos registros simultáneos de la misma devolución parcial dejan uno; las unidades vuelven a su capa.
  const ret = await fixture();
  const retPurchase = await ordered(ret, 4); await supplyService.changePurchase(retPurchase.id, "RECEIVED", retPurchase.revision, ec(30));
  const sale = await orderService.create({ idempotencyKey: randomUUID(), customer, items: [{ productId: ret.productId, variantSku: ret.sku, quantity: 3 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" }) as { _id: unknown };
  for (const status of ["PAID", "PREPARING", "SHIPPED"] as const) await orderService.updateStatus(String(sale._id), status);
  const returnsTry = await Promise.allSettled([1, 2].map(() => orderService.recordReturn(String(sale._id), { reason: "Una unidad golpeada", restock: true, items: [{ variantSku: ret.sku, quantity: 1 }], expectedReturns: 0 })));
  assert.equal(returnsTry.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(((await OrderModel.findById(sale._id).lean()) as { returns?: unknown[] } | null)?.returns?.length, 1);
  const retLots = await rawLots(ret.productId);
  assert.equal(retLots.length, 1); assert.equal(retLots[0]?.quantity, 2); assert.equal(retLots[0]?.receivedOn, ec(30));
  ok("Devolución parcial: dos registros simultáneos dejan uno y la unidad vuelve a su recepción con su fecha");

  // M15: recepción parcial persistida con dos capas y el faltante cerrado.
  const part = await fixture();
  const partDraft = await supplyService.savePurchase(undefined, { supplierId: part.supplierId, warehouseId: "main", items: [{ productId: part.productId, sku: part.sku, quantity: 5, unitCost: 4, expiresOn: "2090-01-01" }] });
  const p1 = await supplyService.receive(partDraft.id, partDraft.revision, { receivedOn: ec(3), lines: [{ index: 0, quantity: 2 }] });
  const p2 = await supplyService.receive(partDraft.id, p1.revision, { lines: [{ index: 0, quantity: 1 }], closeRemaining: true, reason: "Faltaron 2 unidades" });
  const storedPart = await PurchaseModel.findById(partDraft.id).lean() as { status: string; receipts?: unknown[]; shortages?: Array<{ quantity: number }> } | null;
  assert.equal(p2.status, "RECEIVED"); assert.equal(storedPart?.status, "RECEIVED"); assert.equal(storedPart?.receipts?.length, 2); assert.equal(storedPart?.shortages?.[0]?.quantity, 2);
  assert.deepEqual((await rawLots(part.productId)).map(l => [l.quantity, l.receivedOn]).sort(), [[2, ec(3)], [1, ec(0)]].sort());
  ok("Recepción parcial: dos entregas con capas y fechas propias y el faltante cerrado quedan guardados en MongoDB");

  // M45: verificación de índices y bloqueo selectivo ante duplicados previos, sin borrarlos.
  const clean = await ensureIndexes();
  assert.equal(clean.ok, true); assert.equal(clean.missing.length, 0);
  ok("Arranque con índices únicos de pedidos y compras creados y verificados en la lista real de índices");
  await PurchaseModel.collection.dropIndex("requestKey_1");
  await PurchaseModel.collection.insertMany([{ _id: "dup-a", requestKey: "repetida", status: "DRAFT" }, { _id: "dup-b", requestKey: "repetida", status: "DRAFT" }] as never);
  const broken = await ensureIndexes();
  assert.equal(broken.ok, false);
  assert.deepEqual(broken.missing.map(m => [m.model, m.collisions[0]?.count]), [["Purchase", 2]]);
  assert.equal(await PurchaseModel.countDocuments({ requestKey: "repetida" }), 2);
  await assert.rejects(supplyService.savePurchase(undefined, body, undefined, { key: "nueva-clave", actorId: "asistente" }), /protección contra duplicados/);
  await supplyService.savePurchase(undefined, body);
  await orderService.create({ idempotencyKey: randomUUID(), customer, items: [{ productId: f.productId, variantSku: f.sku, quantity: 1 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" });
  ok("Con duplicados previos el índice falta: se informan 2 valores repetidos sin borrarlos y solo se bloquean las altas de compra con clave");

  await writeFile(process.env.AUDIT_REPORT_PATH!, JSON.stringify({ ok: true, mongo: (await mongoose.connection.db!.admin().serverInfo()).version, checks, limits: ["Réplica local de un nodo: no prueba caída de primario, particiones ni varias instancias de la API", ...limits] }, null, 2));
} finally {
  if (mongoose.connection.readyState === 1) { assert(mongoose.connection.name.startsWith("rawenergy_audit_")); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
}
