// M43: devoluciones parciales con retorno a la capa de origen y resultados sin las unidades devueltas.
import { describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { productService } from "./product.service.js";
import { supplyService } from "./supply.service.js";
import { orderService } from "./order.service.js";
import { computeManagement, type ManagementOrder } from "./management.service.js";
import { mailService } from "./mail.service.js";
import { telegramService } from "./telegram.service.js";
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(mailService, "sendStatusUpdate").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

const daysAgo = (n: number) => new Date(Date.now() - 5 * 3600000 - n * 86400000).toISOString().slice(0, 10);
async function shippedOrder(quantity: number) {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `devolucion-${Math.random().toString(36).slice(2)}`; payload.variants = [{ ...payload.variants[0]!, stock: 0, price: 30 }];
  const product = await productService.upsert(undefined, payload) as { id: string }; const sku = payload.variants[0]!.sku;
  const supplier = await supplyService.saveSupplier(undefined, { name: "Proveedor devoluciones" });
  const draft = await supplyService.savePurchase(undefined, { supplierId: supplier.id, warehouseId: "main", items: [{ productId: product.id, sku, quantity: 5, unitCost: 12, lot: "D", expiresOn: "2090-01-01" }] });
  const ordered = await supplyService.changePurchase(draft.id, "ORDERED", draft.revision);
  await supplyService.changePurchase(ordered.id, "RECEIVED", ordered.revision, daysAgo(40));
  const order = await orderService.create({ customer: { fullName: "Cliente devolución", email: "devolucion@example.test", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Dirección de prueba 123", idNumber: "1700000001", reference: "" }, items: [{ productId: product.id, variantSku: sku, quantity }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" });
  const id = String("id" in order ? order.id : "");
  for (const status of ["PAID", "PREPARING", "SHIPPED"] as const) await orderService.updateStatus(id, status);
  return { id, productId: product.id, sku };
}
const stock = async (id: string) => (await productService.get(id))!.variants[0]!.stock;

describe("Devoluciones parciales (M43)", () => {
  it("devuelve unidades a su capa con fecha y costo, y completa el pedido al devolver todo", async () => {
    const o = await shippedOrder(3);
    expect(await stock(o.productId)).toBe(2);
    const partial = await orderService.recordReturn(o.id, { reason: "Una unidad llegó golpeada", restock: true, items: [{ variantSku: o.sku, quantity: 1 }], expectedReturns: 0 }) as { status: string };
    expect(partial.status).toBe("SHIPPED");
    expect(await stock(o.productId)).toBe(3);
    const layers = (await supplyService.positions()).filter(p => p.productId === o.productId);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ receivedOn: daysAgo(40), unitCost: 12, quantity: 3 });
    await expect(orderService.recordReturn(o.id, { reason: "Repetición accidental", restock: true, items: [{ variantSku: o.sku, quantity: 1 }], expectedReturns: 0 })).rejects.toThrow(/otra devolución/);
    await expect(orderService.recordReturn(o.id, { reason: "Exceso de unidades", restock: true, items: [{ variantSku: o.sku, quantity: 3 }] })).rejects.toThrow(/solo quedan 2/);
    const full = await orderService.recordReturn(o.id, { reason: "Devuelve el resto", restock: false }) as { status: string };
    expect(full.status).toBe("RETURNED");
    expect(await stock(o.productId)).toBe(3);
  });

  it("los resultados quitan solo la parte devuelta del ingreso y del costo", () => {
    const order: ManagementOrder = { createdAt: "2026-09-10T15:00:00Z", status: "COMPLETED", shippingFee: 0, items: [{ productId: "p", variantSku: "S", title: "Producto", quantity: 3, lineTotal: 90, discount: 9, unitCost: 12 }], returns: [{ items: [{ variantSku: "S", quantity: 1 }] }] };
    const products = [{ id: "p", title: "Producto", categories: [], variants: [{ sku: "S", stock: 0, price: 30, flavor: "x" }] }];
    const report = computeManagement(products, [order], { year: 2026, month: 9 }, new Date("2026-10-01T05:00:00Z"));
    expect(report).toMatchObject({ revenue: 54, units: 2 });
    expect(report.margin).toMatchObject({ cost: 24, grossProfit: 30 });
  });
});
