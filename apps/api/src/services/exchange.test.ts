// CMB-01: generar un cambio descuenta en ese momento; reponer, cerrar con diferencia y anular con reingreso.
import { describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { productService } from "./product.service.js";
import { supplyService } from "./supply.service.js";
import { orderService } from "./order.service.js";
import { exchangeService } from "./exchange.service.js";
import { listMovements } from "./stockLedger.service.js";
import { mailService } from "./mail.service.js";
import { telegramService } from "./telegram.service.js";
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

let serial = 0;
const actor = { id: "jefa", name: "Jefa de tienda" };
const daysAgo = (n: number) => new Date(Date.now() - 5 * 3600000 - n * 86400000).toISOString().slice(0, 10);
async function setup(quantity = 6) {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `cambio-${++serial}`; payload.variants = [{ ...payload.variants[0]!, stock: 0 }];
  const product = await productService.upsert(undefined, payload) as { id: string }; const sku = payload.variants[0]!.sku;
  const supplier = await supplyService.saveSupplier(undefined, { name: `Proveedor cambio ${serial}`, taxId: "1793213242001" });
  const draft = await supplyService.savePurchase(undefined, { supplierId: supplier.id, warehouseId: "main", items: [{ productId: product.id, sku, quantity, unitCost: 25.02, lot: "L-C", expiresOn: "2090-01-01" }] });
  const ordered = await supplyService.changePurchase(draft.id, "ORDERED", draft.revision);
  await supplyService.changePurchase(ordered.id, "RECEIVED", ordered.revision, daysAgo(150));
  const layer = (await supplyService.positions()).find(p => p.productId === product.id)!;
  return { productId: product.id, sku, supplierId: supplier.id, layer };
}
const stockOf = async (id: string) => (await productService.get(id))!.variants[0]!.stock;
const input = (f: Awaited<ReturnType<typeof setup>>, quantity: number, extra: Record<string, unknown> = {}) => ({ supplierId: f.supplierId, sealedConfirmed: true, lines: [{ productId: f.productId, sku: f.sku, warehouseId: "main", layerId: f.layer.layerId, quantity }], ...extra });

describe("Cambios con proveedor (CMB-01)", () => {
  it("generar descuenta en ese momento, guarda el valor con IVA y no se repite con la misma clave", async () => {
    const f = await setup();
    const change = await exchangeService.generate(input(f, 4, { replacement: { note: "Cambiar por creatina de 300 g" } }), "clave-cambio-1", actor);
    expect(change).toMatchObject({ status: "ABIERTO", valueOut: 100.08, difference: 100.08, valueIn: 0, replacement: { title: "Cambiar por creatina de 300 g" } });
    expect(await stockOf(f.productId)).toBe(2);
    expect((await exchangeService.generate(input(f, 4, { replacement: { note: "Cambiar por creatina de 300 g" } }), "clave-cambio-1", actor)).id).toBe(change.id);
    expect(await stockOf(f.productId)).toBe(2);
    await expect(exchangeService.generate(input(f, 1), "clave-cambio-1", actor)).rejects.toThrow(/otros datos/);
    const movement = (await listMovements({ productId: f.productId })).rows.find(m => m.reason?.startsWith("Cambio a proveedor"));
    expect(movement).toMatchObject({ delta: -4, layerId: f.layer.layerId, receivedOn: daysAgo(150) });
    expect(await exchangeService.pendingBalance()).toMatchObject({ exchanges: 1, units: 4, pendingValue: 100.08 });
  });

  it("exige confirmar el sellado y no envía unidades reservadas para pedidos", async () => {
    const f = await setup(3);
    await expect(exchangeService.generate({ ...input(f, 1), sealedConfirmed: false }, "clave-sellado-1", actor)).rejects.toThrow(/selladas/);
    await orderService.create({ customer: { fullName: "Cliente cambio", email: "cambio@example.test", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Dirección de prueba 123", idNumber: "1700000001", reference: "" }, items: [{ productId: f.productId, variantSku: f.sku, quantity: 2 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" });
    await expect(exchangeService.generate(input(f, 2), "clave-reservado-1", actor)).rejects.toThrow(/solo hay 1 unidades sin reservar/);
    expect(await stockOf(f.productId)).toBe(1);
  });

  it("vincula la compra de reemplazo del mismo proveedor y cierra explicando la diferencia", async () => {
    const f = await setup();
    const change = await exchangeService.generate(input(f, 4), "clave-reposicion-1", actor);
    const replacement = await supplyService.savePurchase(undefined, { supplierId: f.supplierId, warehouseId: "main", items: [{ productId: f.productId, sku: f.sku, quantity: 3, unitCost: 30, lot: "R", expiresOn: "2090-01-01" }] });
    const linked = await exchangeService.linkReplacement(change.id, change.revision, replacement.id);
    expect(linked).toMatchObject({ status: "REPUESTO", valueIn: 90, difference: 10.08 });
    await expect(exchangeService.close(linked.id, linked.revision, "")).rejects.toThrow(/diferencia/);
    const closed = await exchangeService.close(linked.id, linked.revision, "Nota de crédito por 10,08 en la próxima factura");
    expect(closed.status).toBe("CERRADO_CON_DIFERENCIA");
    const other = await setup();
    const second = await exchangeService.generate(input(other, 1), "clave-reposicion-2", actor);
    await expect(exchangeService.linkReplacement(second.id, second.revision, replacement.id)).rejects.toThrow(/mismo proveedor|otro cambio/);
  });

  it("si el proveedor lo rechaza, las unidades vuelven a su recepción con su fecha", async () => {
    const f = await setup();
    const change = await exchangeService.generate(input(f, 5), "clave-rechazo-1", actor);
    expect(await stockOf(f.productId)).toBe(1);
    const voided = await exchangeService.void(change.id, change.revision, "El proveedor no aceptó el cambio");
    expect(voided.status).toBe("ANULADO");
    expect(await stockOf(f.productId)).toBe(6);
    const layers = (await supplyService.positions()).filter(p => p.productId === f.productId);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ layerId: f.layer.layerId, receivedOn: daysAgo(150), quantity: 6 });
  });
});
