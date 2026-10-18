// ROT-01: antigüedad por recepción y poca salida con umbrales adaptados a la venta real.
import { describe, expect, it, vi } from "vitest";
import { addMonths, computeAging, statusFor, stockDays, defaultAgingConfig, inventoryAgingService } from "./inventoryAging.service.js";
import type { LayerPosition } from "./inventoryPositions.js";
import { demoProducts } from "../data/demoProducts.js";
import { productService } from "./product.service.js";
import { supplyService } from "./supply.service.js";
import { orderService } from "./order.service.js";
import { mailService } from "./mail.service.js";
import { telegramService } from "./telegram.service.js";
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(mailService, "sendStatusUpdate").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

const layer = (over: Partial<LayerPosition>): LayerPosition => ({ productId: "p", sku: "S", title: "Producto", warehouseId: "main", lot: "L", expiresOn: "2090-01-01", unitCost: 10, layerId: "x", receivedOn: "", source: "PURCHASE", quantity: 0, available: 0, reserved: 0, onHand: 0, sellable: 0, expired: false, ...over });

describe("Regla de antigüedad (ROT-01)", () => {
  it("suma seis meses calendario con ajuste al fin de mes", () => {
    expect(addMonths("2026-10-13", 6)).toBe("2027-04-13");
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonths("2027-08-31", 6)).toBe("2028-02-29");
  });
  it("aplica los límites de 60, 30 y 0 días", () => {
    expect([61, 60, 31, 30, 1, 0, -5, null].map(d => statusFor(d, defaultAgingConfig))).toEqual(["EN_PLAZO", "PREPARAR", "PREPARAR", "PRIORITARIO", "PRIORITARIO", "OBJETIVO_ALCANZADO", "OBJETIVO_ALCANZADO", "SIN_FECHA"]);
  });
  it("proyecta lo que sobrará vendiendo primero lo más antiguo, con la velocidad de cada producto", () => {
    const result = computeAging({
      today: "2026-10-14",
      positions: [layer({ layerId: "viejo", receivedOn: "2026-05-13", onHand: 10, available: 10 }), layer({ layerId: "nuevo", receivedOn: "2026-10-01", onHand: 20, available: 18, reserved: 2 })],
      unitsSold: new Map([["p:S", 30]]), daysWithStock: new Map([["p:S", 60]])
    });
    const old = result.layers.find(l => l.layerId === "viejo")!, recent = result.layers.find(l => l.layerId === "nuevo")!;
    expect(old).toMatchObject({ status: "PRIORITARIO", daysToTarget: 30, targetOn: "2026-11-13", ageDays: 154, leftoverAtTarget: 0, costValue: 100 });
    // 0,5 u/día × 169 días ≈ 84 u: las 30 se venden antes del objetivo de la capa nueva.
    expect(recent).toMatchObject({ status: "EN_PLAZO", targetOn: "2027-04-01", leftoverAtTarget: 0 });
    expect(result.slow).toEqual([]);
    expect(result.summary.toManage).toMatchObject({ products: 1, units: 10, costValue: 100, costComplete: true, nextTargetOn: "2026-11-13" });
  });
  it("marca poca salida cuando sobrarán unidades o no hubo ventas con stock disponible", () => {
    const slow = computeAging({ today: "2026-10-14", positions: [layer({ receivedOn: "2026-08-14", onHand: 40, available: 40 })], unitsSold: new Map([["p:S", 9]]), daysWithStock: new Map([["p:S", 90]]) });
    expect(slow.slow[0]).toMatchObject({ reason: "SOBRARAN", dailyVelocity: 0.1, leftoverAtTarget: 28 });
    const none = computeAging({ today: "2026-10-14", positions: [layer({ receivedOn: "2026-08-14", onHand: 5, available: 5 })], unitsSold: new Map(), daysWithStock: new Map([["p:S", 45]]) });
    expect(none.slow[0]).toMatchObject({ reason: "SIN_VENTAS", unitsSold: 0 });
  });
  it("con poco historial no proyecta, y lo indica; sin fecha de recepción no inventa edad", () => {
    const result = computeAging({ today: "2026-10-14", positions: [layer({ receivedOn: "2026-10-01", onHand: 5 }), layer({ productId: "q", layerId: "legacy", receivedOn: "", source: "LEGACY", onHand: 3, unitCost: null })], unitsSold: new Map(), daysWithStock: new Map([["p:S", 10]]) });
    expect(result.slow).toEqual([]);
    expect(result.insufficientHistory).toBe(2);
    expect(result.layers.find(l => l.layerId === "legacy")).toMatchObject({ status: "SIN_FECHA", ageDays: null, targetOn: null, costValue: null });
  });
  it("avisa si el vencimiento del envase llega antes del objetivo interno", () => {
    const result = computeAging({ today: "2026-10-14", positions: [layer({ receivedOn: "2026-10-01", expiresOn: "2027-01-31", onHand: 2 })], unitsSold: new Map(), daysWithStock: new Map() });
    expect(result.layers[0]!.expiresBeforeTarget).toBe(true);
    expect(result.summary.expiresBeforeTarget).toBe(1);
  });
  it("cuenta solo los días con stock disponible", () => {
    const start = new Date("2026-07-16T05:00:00Z"), end = new Date("2026-10-14T05:00:00Z");
    const days = stockDays([
      { productId: "p", sku: "S", after: 5, createdAt: "2026-07-01T05:00:00Z" },
      { productId: "p", sku: "S", after: 0, createdAt: "2026-08-15T05:00:00Z" },
      { productId: "p", sku: "S", after: 4, createdAt: "2026-09-14T05:00:00Z" }
    ], start, end);
    expect(Math.round(days.get("p:S")!)).toBe(60);
  });
});

describe("Antigüedad con datos del sistema (ROT-01)", () => {
  it("usa recepciones, ventas y proveedor reales y no rejuvenece al reponer", async () => {
    const payload = structuredClone(demoProducts[1]!); payload.slug = "antiguedad-1"; payload.variants = [{ ...payload.variants[0]!, stock: 0 }];
    const product = await productService.upsert(undefined, payload) as { id: string }; const sku = payload.variants[0]!.sku;
    const supplier = await supplyService.saveSupplier(undefined, { name: "Proveedor antigüedad" });
    const receive = async (quantity: number, receivedOn: string) => { const d = await supplyService.savePurchase(undefined, { supplierId: supplier.id, warehouseId: "main", items: [{ productId: product.id, sku, quantity, unitCost: 10, lot: "A", expiresOn: "2090-01-01" }] }); const o = await supplyService.changePurchase(d.id, "ORDERED", d.revision); await supplyService.changePurchase(o.id, "RECEIVED", o.revision, receivedOn); };
    const daysAgo = (n: number) => new Date(Date.now() - 5 * 3600000 - n * 86400000).toISOString().slice(0, 10);
    await receive(6, daysAgo(160));
    await receive(4, daysAgo(1));
    const order = await orderService.create({ customer: { fullName: "Cliente antigüedad", email: "antiguedad@example.test", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Dirección de prueba 123", idNumber: "1700000001", reference: "" }, items: [{ productId: product.id, variantSku: sku, quantity: 2 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" });
    await orderService.updateStatus(String("id" in order ? order.id : ""), "PAID");
    const result = await inventoryAgingService.overview();
    const mine = result.layers.filter(l => l.productId === product.id);
    expect(mine.map(l => [l.receivedOn, l.onHand])).toEqual([[daysAgo(160), 6], [daysAgo(1), 4]]); // pagado sin despachar: sigue físicamente en bodega
    expect(mine[0]).toMatchObject({ status: "PRIORITARIO", supplierName: "Proveedor antigüedad" });
    expect(result.config).toEqual(defaultAgingConfig);
  });
});
