// M15: recepción parcial con faltantes; M32: lote del fabricante opcional.
import { describe, expect, it } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { productService } from "./product.service.js";
import { supplyService } from "./supply.service.js";

const daysAgo = (n: number) => new Date(Date.now() - 5 * 3600000 - n * 86400000).toISOString().slice(0, 10);
let serial = 0;
async function setup() {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `parcial-${++serial}`; payload.variants = [{ ...payload.variants[0]!, stock: 0 }];
  const product = await productService.upsert(undefined, payload) as { id: string }; const sku = payload.variants[0]!.sku;
  const supplier = await supplyService.saveSupplier(undefined, { name: `Proveedor parcial ${serial}` });
  const draft = await supplyService.savePurchase(undefined, { supplierId: supplier.id, warehouseId: "main", items: [{ productId: product.id, sku, quantity: 10, unitCost: 5, expiresOn: "2090-01-01" }] });
  return { productId: product.id, sku, draft };
}
const layers = async (productId: string) => (await supplyService.positions()).filter(p => p.productId === productId);

describe("Recepción parcial (M15) y lote opcional (M32)", () => {
  it("recibe en dos entregas con capas y fechas propias, y termina recibida", async () => {
    const f = await setup();
    expect(f.draft.items[0]!.lot).toBe("SIN-LOTE");
    const first = await supplyService.receive(f.draft.id, f.draft.revision, { receivedOn: daysAgo(5), lines: [{ index: 0, quantity: 6 }] });
    expect(first).toMatchObject({ status: "PARTIAL", items: [{ receivedQuantity: 6 }] });
    expect((await supplyService.inTransit()).find(p => p.id === f.draft.id)?.items[0]?.quantity).toBe(4);
    await expect(supplyService.receive(f.draft.id, first.revision, { lines: [{ index: 0, quantity: 5 }] })).rejects.toThrow(/solo quedan 4/);
    await expect(supplyService.changePurchase(f.draft.id, "CANCELLED", first.revision)).rejects.toThrow(/en parte/);
    const second = await supplyService.receive(f.draft.id, first.revision, { lines: [{ index: 0, quantity: 4 }] });
    expect(second.status).toBe("RECEIVED");
    expect((await layers(f.productId)).map(l => [l.layerId, l.quantity, l.receivedOn]).sort()).toEqual([[`P-${f.draft.id}-0`, 6, daysAgo(5)], [`P-${f.draft.id}-0-2`, 4, daysAgo(0)]].sort());
  });

  it("cierra lo que no llegó como faltante con motivo y valor, sin tocar el total de la factura", async () => {
    const f = await setup();
    await expect(supplyService.receive(f.draft.id, f.draft.revision, { lines: [{ index: 0, quantity: 7 }], closeRemaining: true })).rejects.toThrow(/Explica/);
    const closed = await supplyService.receive(f.draft.id, f.draft.revision, { lines: [{ index: 0, quantity: 7 }], closeRemaining: true, reason: "Faltaron 3 unidades; nota de crédito pendiente" });
    expect(closed).toMatchObject({ status: "RECEIVED", total: 50, shortages: [{ index: 0, quantity: 3, value: 15 }] });
    expect((await layers(f.productId))[0]).toMatchObject({ quantity: 7 });
    expect((await supplyService.inTransit()).some(p => p.id === f.draft.id)).toBe(false);
  });
});
