// M40/M46: capas de inventario con fecha efectiva y origen (modo memoria).
import { describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { productService } from "./product.service.js";
import { supplyService } from "./supply.service.js";
import { orderService } from "./order.service.js";
import { mailService } from "./mail.service.js";
import { telegramService } from "./telegram.service.js";
import { listMovements, legacyLayerId } from "./stockLedger.service.js";
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(mailService, "sendStatusUpdate").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

let serial = 0;
const today = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - 5 * 3600000 - days * 86400000).toISOString().slice(0, 10);
const customer = { fullName: "Capas de prueba", email: "capas@example.com", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Dirección de prueba 123", idNumber: "1700000001", reference: "" };

async function setup(stock = 0) {
  const payload = structuredClone(demoProducts[1]!);
  payload.slug = `capas-${++serial}`;
  payload.variants = [payload.variants[0]!];
  payload.variants[0]!.stock = stock;
  const product = await productService.upsert(undefined, payload) as { id: string };
  const supplier = await supplyService.saveSupplier(undefined, { name: `Proveedor capas ${serial}`, leadDays: 4 });
  return { productId: product.id, sku: payload.variants[0]!.sku, supplierId: supplier.id };
}
async function receive(f: Awaited<ReturnType<typeof setup>>, quantity: number, receivedOn?: string, lot = "LOTE-X", expiresOn = "2090-01-01", unitCost = 12) {
  const draft = await supplyService.savePurchase(undefined, { supplierId: f.supplierId, warehouseId: "main", items: [{ productId: f.productId, sku: f.sku, quantity, unitCost, lot, expiresOn }] });
  const ordered = await supplyService.changePurchase(draft.id, "ORDERED", draft.revision);
  return supplyService.changePurchase(ordered.id, "RECEIVED", ordered.revision, receivedOn);
}
const layersOf = async (productId: string) => (await supplyService.positions()).filter(p => p.productId === productId);

describe("Capas de inventario (M40/M46)", () => {
  it("separa dos recepciones con igual lote, vencimiento y costo y conserva la fecha efectiva", async () => {
    const f = await setup();
    const first = await receive(f, 3, daysAgo(20));
    const second = await receive(f, 2);
    const layers = await layersOf(f.productId);
    expect(layers).toHaveLength(2);
    expect(layers.find(l => l.purchaseId === first.id)).toMatchObject({ quantity: 3, receivedOn: daysAgo(20), source: "PURCHASE", layerId: `P-${first.id}-0`, purchaseLine: 0 });
    expect(layers.find(l => l.purchaseId === second.id)).toMatchObject({ quantity: 2, receivedOn: today(), layerId: `P-${second.id}-0` });
    expect(first.receivedOn).toBe(daysAgo(20));
  });

  it("un borrador se recibe directamente cuando factura y mercadería llegan juntas (M14)", async () => {
    const f = await setup();
    const draft = await supplyService.savePurchase(undefined, { supplierId: f.supplierId, warehouseId: "main", items: [{ productId: f.productId, sku: f.sku, quantity: 2, unitCost: 9, lot: "DIRECTO", expiresOn: "2090-01-01" }] });
    const received = await supplyService.changePurchase(draft.id, "RECEIVED", draft.revision, daysAgo(2));
    expect(received).toMatchObject({ status: "RECEIVED", receivedOn: daysAgo(2) });
    expect((await layersOf(f.productId))[0]).toMatchObject({ quantity: 2, receivedOn: daysAgo(2), purchaseId: draft.id });
  });

  it("rechaza fechas de recepción futuras o de hace más de un año", async () => {
    const f = await setup();
    const draft = await supplyService.savePurchase(undefined, { supplierId: f.supplierId, warehouseId: "main", items: [{ productId: f.productId, sku: f.sku, quantity: 1, unitCost: 5, lot: "L", expiresOn: "2090-01-01" }] });
    const ordered = await supplyService.changePurchase(draft.id, "ORDERED", 0);
    await expect(supplyService.changePurchase(ordered.id, "RECEIVED", 1, "2999-01-01")).rejects.toThrow(/futura/);
    await expect(supplyService.changePurchase(ordered.id, "RECEIVED", 1, daysAgo(400))).rejects.toThrow(/año/);
    await expect(supplyService.changePurchase(ordered.id, "RECEIVED", 1, "2026-02-31")).rejects.toThrow();
  });

  it("vende primero la capa más antigua y al cancelar devuelve cada unidad a su capa", async () => {
    const f = await setup();
    const old = await receive(f, 2, daysAgo(30));
    const recent = await receive(f, 2);
    const order = await orderService.create({ customer, items: [{ productId: f.productId, variantSku: f.sku, quantity: 3 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" });
    const id = String("id" in order ? order.id : "");
    const allocations = (await orderService.get(id))?.items[0]?.allocations ?? [];
    expect(allocations.map(a => [a.layerId, a.quantity])).toEqual([[`P-${old.id}-0`, 2], [`P-${recent.id}-0`, 1]]);
    expect(allocations.map(a => a.purchaseId)).toEqual([old.id, recent.id]); // origen de la venta sin leer la auditoría (M46)
    const reserved = await layersOf(f.productId);
    expect(reserved.find(l => l.purchaseId === old.id)).toMatchObject({ available: 0, reserved: 2, onHand: 2 });
    await orderService.updateStatus(id, "CANCELLED");
    const layers = await layersOf(f.productId);
    expect(layers).toHaveLength(2);
    expect(layers.find(l => l.purchaseId === old.id)).toMatchObject({ quantity: 2, receivedOn: daysAgo(30) });
    expect(layers.find(l => l.purchaseId === recent.id)).toMatchObject({ quantity: 2, receivedOn: today() });
  });

  it("un traslado conserva capa, fecha y origen en la bodega destino", async () => {
    const f = await setup();
    const purchase = await receive(f, 4, daysAgo(10));
    await receive(f, 1);
    const target = await supplyService.saveWarehouse(undefined, { name: `Bodega capas ${serial}` });
    await expect(supplyService.transfer({ productId: f.productId, sku: f.sku, from: "main", to: target.id, lot: "LOTE-X", quantity: 1, reason: "Traslado ambiguo" })).rejects.toThrow(/varios lotes/);
    await supplyService.transfer({ productId: f.productId, sku: f.sku, from: "main", to: target.id, lot: "LOTE-X", layerId: `P-${purchase.id}-0`, quantity: 3, reason: "Reubicación de capa" });
    const moved = (await layersOf(f.productId)).find(l => l.warehouseId === target.id);
    expect(moved).toMatchObject({ quantity: 3, layerId: `P-${purchase.id}-0`, receivedOn: daysAgo(10), purchaseId: purchase.id });
  });

  it("los movimientos guardan capa, compra, línea y fecha efectiva", async () => {
    const f = await setup();
    const purchase = await receive(f, 2, daysAgo(5));
    const row = (await listMovements({ productId: f.productId })).rows.find(m => m.reason?.startsWith("Recepción"));
    expect(row).toMatchObject({ delta: 2, layerId: `P-${purchase.id}-0`, purchaseId: purchase.id, purchaseLine: 0, receivedOn: daysAgo(5), source: "PURCHASE" });
  });

  it("los saldos antiguos sin capa reciben una identidad estable sin fecha inventada", async () => {
    const f = await setup(3);
    const [initial] = await layersOf(f.productId);
    expect(initial).toMatchObject({ lot: "INICIAL", receivedOn: "", source: "LEGACY", layerId: legacyLayerId({ lot: "INICIAL", expiresOn: "", unitCost: null }) });
    const order = await orderService.create({ customer, items: [{ productId: f.productId, variantSku: f.sku, quantity: 2 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" });
    await orderService.updateStatus(String("id" in order ? order.id : ""), "CANCELLED");
    const layers = await layersOf(f.productId);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ quantity: 3, layerId: initial!.layerId });
  });

  it("una entrada sin compra crea su propia capa con fecha de hoy y no rejuvenece la anterior", async () => {
    const f = await setup();
    await receive(f, 2, daysAgo(40), "SIN-LOTE", "2090-01-01", 7);
    await productService.changeStock(f.productId, f.sku, 1, { lot: "SIN-LOTE", expiresOn: "2090-01-01", unitCost: 7, reason: "Ajuste positivo de prueba" });
    const layers = await layersOf(f.productId);
    expect(layers).toHaveLength(2);
    expect(layers.find(l => l.source === "ADJUSTMENT")).toMatchObject({ quantity: 1, receivedOn: today() });
    expect(layers.find(l => l.source === "PURCHASE")).toMatchObject({ quantity: 2, receivedOn: daysAgo(40) });
  });
});
