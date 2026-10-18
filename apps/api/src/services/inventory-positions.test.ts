// M41: una sola regla para unidades físicas, reservadas, disponibles, vendibles y vencidas.
import { describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { productService } from "./product.service.js";
import { supplyService } from "./supply.service.js";
import { orderService } from "./order.service.js";
import { mailService } from "./mail.service.js";
import { telegramService } from "./telegram.service.js";
import { computeManagement, type ManagementProduct } from "./management.service.js";
import { layerPositions, totalsBySku, type ReservedLot } from "./inventoryPositions.js";
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(mailService, "sendStatusUpdate").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

const customer = { fullName: "Existencias de prueba", email: "existencias@example.com", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Dirección de prueba 123", idNumber: "1700000001", reference: "" };
const daysAgo = (days: number) => new Date(Date.now() - 5 * 3600000 - days * 86400000).toISOString().slice(0, 10);
const buy = (productId: string, sku: string, quantity: number) => orderService.create({ customer, items: [{ productId, variantSku: sku, quantity }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" });

describe("Existencias por capa (M41)", () => {
  it("cumple físicas = sin reservar + reservadas y el dashboard usa las mismas cifras", async () => {
    const payload = structuredClone(demoProducts[1]!); payload.slug = "existencias-m41"; payload.variants = [{ ...payload.variants[0]!, stock: 0 }];
    const product = await productService.upsert(undefined, payload) as { id: string };
    const productId = product.id, sku = payload.variants[0]!.sku;
    const supplier = await supplyService.saveSupplier(undefined, { name: "Proveedor existencias" });
    for (const [quantity, receivedOn] of [[5, daysAgo(20)], [3, daysAgo(0)]] as const) {
      const draft = await supplyService.savePurchase(undefined, { supplierId: supplier.id, warehouseId: "main", items: [{ productId, sku, quantity, unitCost: 10, lot: "LOTE-E", expiresOn: "2090-01-01" }] });
      const ordered = await supplyService.changePurchase(draft.id, "ORDERED", draft.revision);
      await supplyService.changePurchase(ordered.id, "RECEIVED", ordered.revision, receivedOn);
    }
    await productService.changeStock(productId, sku, 2, { lot: "VENCIDO", expiresOn: "2020-01-01", unitCost: 8, reason: "Saldo vencido de prueba" });
    await buy(productId, sku, 4);
    const second = await buy(productId, sku, 2);
    await orderService.updateStatus(String("id" in second ? second.id : ""), "CANCELLED");
    const target = await supplyService.saveWarehouse(undefined, { name: "Bodega existencias" });
    const recent = (await supplyService.positions()).find(p => p.productId === productId && p.receivedOn === daysAgo(0))!;
    await supplyService.transfer({ productId, sku, from: "main", to: target.id, lot: "LOTE-E", layerId: recent.layerId, quantity: 1, reason: "Traslado de prueba" });

    const rows = (await supplyService.positions()).filter(p => p.productId === productId);
    for (const row of rows) expect(row.onHand).toBe(row.available + row.reserved);
    const variant = (await productService.get(productId))!.variants[0]!;
    expect(rows.reduce((s, r) => s + r.available, 0)).toBe(variant.stock);
    expect(rows.reduce((s, r) => s + r.reserved, 0)).toBe(4);
    expect(rows.reduce((s, r) => s + r.onHand, 0)).toBe(10);
    const expired = rows.find(r => r.lot === "VENCIDO")!;
    expect(expired).toMatchObject({ expired: true, sellable: 0, available: 2 });

    const reservations = await orderService.reservedPositions() as unknown as ReservedLot[];
    const totals = totalsBySku(layerPositions([await productService.get(productId) as never], reservations)).get(`${productId}:${sku}`)!;
    expect(totals).toEqual({ onHand: 10, reserved: 4, available: 6, sellable: 4, expired: 2, costValue: 96, costComplete: true });
    const report = computeManagement([await productService.get(productId) as unknown as ManagementProduct], [], { year: 2026, month: 0 }, new Date(), [], [], reservations);
    expect(report.inventory.find(r => r.sku === sku)).toMatchObject({ physicalStock: 10, reservedStock: 4, availableStock: 4, expiredStock: 2 });
  });

  it("el valor a costo marca como incompleto el stock sin costo registrado (M44)", () => {
    const totals = totalsBySku(layerPositions([{ id: "p", title: "Producto", variants: [{ sku: "S", stock: 5, lots: [{ warehouseId: "main", lot: "A", expiresOn: "", quantity: 3, unitCost: 10 }, { warehouseId: "main", lot: "INICIAL", expiresOn: "", quantity: 2, unitCost: null }] }] }], [])).get("p:S")!;
    expect(totals).toMatchObject({ onHand: 5, costValue: 30, costComplete: false });
  });

  it("una reserva antigua sin capa cuenta en la misma capa que su lote", () => {
    const rows = layerPositions(
      [{ id: "p", title: "Producto", variants: [{ sku: "S", stock: 2, lots: [{ warehouseId: "main", lot: "A", expiresOn: "2090-01-01", quantity: 2, unitCost: 5 }] }] }],
      [{ productId: "p", sku: "S", warehouseId: "main", lot: "A", expiresOn: "2090-01-01", unitCost: 5, quantity: 1 }]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ available: 2, reserved: 1, onHand: 3, sellable: 2, source: "LEGACY", receivedOn: "" });
  });
});
