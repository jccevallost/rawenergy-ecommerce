// M35: alta de compra idempotente y huella canónica.
import { describe, expect, it } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { productService } from "./product.service.js";
import { supplyService } from "./supply.service.js";
import { canonicalJson, contentFingerprint } from "../lib/canonical.js";

let serial = 0;
async function setup() {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `idem-${++serial}`; payload.variants = [{ ...payload.variants[0]!, stock: 0 }];
  const product = await productService.upsert(undefined, payload) as { id: string };
  const supplier = await supplyService.saveSupplier(undefined, { name: `Proveedor idem ${serial}` });
  return { supplierId: supplier.id, warehouseId: "main", items: [{ productId: product.id, sku: payload.variants[0]!.sku, quantity: 2, unitCost: 10, lot: "L-1", expiresOn: "2090-01-01" }] };
}
const count = async (supplierId: string) => (await supplyService.purchases()).filter(p => p.supplierId === supplierId).length;

describe("Alta de compra idempotente (M35)", () => {
  it("la misma clave y el mismo contenido devuelven la misma compra", async () => {
    const input = await setup();
    const first = await supplyService.savePurchase(undefined, input, undefined, { key: "clave-operacion-1", actorId: "asistente" });
    const retry = await supplyService.savePurchase(undefined, structuredClone(input), undefined, { key: "clave-operacion-1", actorId: "asistente" });
    expect(retry.id).toBe(first.id);
    expect(retry.number).toBe(first.number);
    expect(await count(input.supplierId)).toBe(1);
  });

  it("el orden de las propiedades no cambia la huella", async () => {
    const input = await setup();
    const reordered = { items: input.items.map(i => ({ expiresOn: i.expiresOn, lot: i.lot, unitCost: i.unitCost, quantity: i.quantity, sku: i.sku, productId: i.productId })), warehouseId: input.warehouseId, supplierId: input.supplierId };
    const first = await supplyService.savePurchase(undefined, input, undefined, { key: "clave-orden-1", actorId: "asistente" });
    expect((await supplyService.savePurchase(undefined, reordered, undefined, { key: "clave-orden-1", actorId: "asistente" })).id).toBe(first.id);
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(contentFingerprint({ a: 1, b: 2 })).toBe(contentFingerprint({ b: 2, a: 1 }));
  });

  it("la misma clave con otro contenido se rechaza sin crear otra compra", async () => {
    const input = await setup();
    await supplyService.savePurchase(undefined, input, undefined, { key: "clave-distinta-1", actorId: "asistente" });
    const changed = { ...input, items: [{ ...input.items[0]!, quantity: 3 }] };
    await expect(supplyService.savePurchase(undefined, changed, undefined, { key: "clave-distinta-1", actorId: "asistente" })).rejects.toThrow(/otros datos/);
    expect(await count(input.supplierId)).toBe(1);
  });

  it("la clave pertenece a quien la usa y sin clave cada alta es nueva", async () => {
    const input = await setup();
    const mine = await supplyService.savePurchase(undefined, input, undefined, { key: "clave-compartida-1", actorId: "persona-a" });
    const other = await supplyService.savePurchase(undefined, input, undefined, { key: "clave-compartida-1", actorId: "persona-b" });
    expect(other.id).not.toBe(mine.id);
    await supplyService.savePurchase(undefined, input);
    expect(await count(input.supplierId)).toBe(3);
  });

  it("editar el borrador conserva la clave original", async () => {
    const input = await setup();
    const draft = await supplyService.savePurchase(undefined, input, undefined, { key: "clave-edicion-1", actorId: "asistente" });
    const edited = await supplyService.savePurchase(draft.id, { ...input, notes: "Nota agregada" }, draft.revision);
    expect(edited.requestKey).toBe(draft.requestKey);
    expect((await supplyService.savePurchase(undefined, input, undefined, { key: "clave-edicion-1", actorId: "asistente" })).id).toBe(draft.id);
  });
});
