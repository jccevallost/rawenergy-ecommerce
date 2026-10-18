// M05: dinero exacto y factura de compra. Caso fijo: factura FITLAB 002-100-000004199 del 13/10/2026
// (sección 18 del plan). Solo datos de prueba en memoria: no registra la compra real.
import { describe, expect, it } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { productService } from "./product.service.js";
import { supplyService } from "./supply.service.js";
import { reconcileInvoice, legacyTotal, type InvoiceDocument } from "./purchaseDocument.js";
import { allocateCents, formatDecimal, parseDecimal } from "../lib/money.js";
import { accessKeyCheckDigit, parseAccessKey } from "../lib/ecuadorInvoice.js";

const fitlabLines: Array<[number, string, string]> = [
  [4, "34.000000", "136.00"], [4, "21.756521", "87.03"], [1, "21.078261", "21.08"], [2, "21.756522", "43.51"], [1, "30.434783", "30.43"],
  [2, "10.234783", "20.47"], [2, "19.043478", "38.09"], [12, "1.417391", "17.01"], [2, "8.165217", "16.33"], [1, "21.739130", "21.74"]
];
const fitlabDocument: InvoiceDocument = { type: "FACTURA", supplierTaxId: "1793213242001", number: "002-100-000004199", issuedOn: "2026-10-13", accessKey: "1310202601179321324200120021000000041991234567812", subtotal: "431.69", tax: "64.75", total: "496.44" };
const lines = () => fitlabLines.map(([quantity, netUnitCost, netTotal]) => ({ quantity, netUnitCost, netTotal, taxRate: 15 as const }));

describe("Dinero exacto (M05)", () => {
  it("lee importes con coma o punto y rechaza más decimales de los permitidos", () => {
    expect(formatDecimal(parseDecimal("87,03"), 2)).toBe("87.03");
    expect(formatDecimal(parseDecimal("21.756521"), 6)).toBe("21.756521");
    expect(() => parseDecimal("1.1234567")).toThrow(/6 decimales/);
    expect(() => parseDecimal("-1")).toThrow();
  });
  it("reparte centavos por mayor residuo sumando exactamente el total", () => {
    const parts = allocateCents(parseDecimal("1.00"), [1n, 1n, 1n].map(n => n * 1000000n));
    expect(parts.map(p => formatDecimal(p))).toEqual(["0.34", "0.33", "0.33"]);
  });
  it("valida la clave de acceso con su dígito verificador", () => {
    expect(accessKeyCheckDigit(fitlabDocument.accessKey.slice(0, 48))).toBe(2);
    expect(parseAccessKey(fitlabDocument.accessKey)).toMatchObject({ issuedOn: "2026-10-13", documentType: "01", taxId: "1793213242001", series: "002100", sequential: "000004199" });
    expect(parseAccessKey(`${fitlabDocument.accessKey.slice(0, 48)}3`)).toMatch(/dígito verificador/);
  });
  it("el total sin factura usa decimales exactos", () => {
    expect(legacyTotal([{ quantity: 4, unitCost: 21.756521 }, { quantity: 3, unitCost: 0.1 }])).toBe(87.33);
  });
});

describe("Factura FITLAB como caso fijo (M05)", () => {
  it("concilia 10 líneas, reparte 64,75 de IVA y deriva el costo unitario con IVA", () => {
    const result = reconcileInvoice(fitlabDocument, lines());
    expect(result.document).toMatchObject({ subtotal: "431.69", tax: "64.75", total: "496.44", taxMethod: "GLOBAL" });
    expect(result.lines.map(l => l.taxAllocated)).toEqual(["20.40", "13.05", "3.16", "6.53", "4.57", "3.07", "5.71", "2.55", "2.45", "3.26"]);
    expect(result.lines.map(l => l.unitCost)).toEqual([39.1, 25.02, 24.24, 25.02, 35, 11.77, 21.9, 1.63, 9.39, 25]);
    expect(result.total).toBe(496.44);
    expect(result.calculatedTotal).toBe(496.44);
    expect(fitlabLines.reduce((units, [q]) => units + q, 0)).toBe(31);
  });
  it("explica qué revisar cuando una cifra no cuadra, sin corregirla", () => {
    const wrongLine = lines(); wrongLine[1] = { ...wrongLine[1]!, netTotal: "87.04" };
    expect(() => reconcileInvoice(fitlabDocument, wrongLine)).toThrow(/Línea 2: 4 × 21.756521 = 87.026084, pero el total de la línea es 87.04/);
    expect(() => reconcileInvoice({ ...fitlabDocument, subtotal: "431.70" }, lines())).toThrow(/suma de las líneas \(431.69\)/);
    expect(() => reconcileInvoice({ ...fitlabDocument, tax: "64.76" }, lines())).toThrow(/IVA de la factura \(64.76\)/);
    expect(() => reconcileInvoice({ ...fitlabDocument, total: "496.45" }, lines())).toThrow(/no coincide con el total/);
    expect(() => reconcileInvoice({ ...fitlabDocument, number: "002-100-000004198" }, lines())).toThrow(/clave de acceso/);
    expect(() => reconcileInvoice({ ...fitlabDocument, issuedOn: "2026-10-14" }, lines())).toThrow(/fecha de la clave/);
  });
  it("acepta el IVA calculado línea por línea cuando la factura lo usa", () => {
    const result = reconcileInvoice({ ...fitlabDocument, accessKey: "", tax: "64.74", total: "496.43" }, lines());
    expect(result.document.taxMethod).toBe("PER_LINE");
    expect(result.calculatedTotal).toBe(496.43);
  });
});

describe("Compra con factura (M05)", () => {
  let serial = 0;
  async function setup(taxId = "") {
    const payload = structuredClone(demoProducts[1]!); payload.slug = `factura-${++serial}`; payload.variants = [{ ...payload.variants[0]!, stock: 0 }];
    const product = await productService.upsert(undefined, payload) as { id: string };
    const supplier = await supplyService.saveSupplier(undefined, { name: `Proveedor factura ${serial}`, taxId });
    return { supplierId: supplier.id, warehouseId: "main", productId: product.id, sku: payload.variants[0]!.sku };
  }
  const purchaseInput = (f: Awaited<ReturnType<typeof setup>>, document = fitlabDocument) => ({ supplierId: f.supplierId, warehouseId: f.warehouseId, document, items: lines().map((line, i) => ({ productId: f.productId, sku: f.sku, ...line, lot: `L-${i}`, expiresOn: "2090-01-01" })) });

  it("guarda la factura, el total impreso y recibe las capas con costo con IVA", async () => {
    const f = await setup("1793213242001");
    const draft = await supplyService.savePurchase(undefined, purchaseInput(f));
    expect(draft).toMatchObject({ total: 496.44, calculatedTotal: 496.44, documentKey: "1793213242001:FACTURA:002-100-000004199" });
    expect(draft.items[1]).toMatchObject({ netUnitCost: "21.756521", netTotal: "87.03", taxAllocated: "13.05", costWithTax: "100.08", unitCost: 25.02 });
    const ordered = await supplyService.changePurchase(draft.id, "ORDERED", draft.revision);
    await supplyService.changePurchase(ordered.id, "RECEIVED", ordered.revision);
    const layers = (await supplyService.positions()).filter(p => p.productId === f.productId);
    expect(layers.reduce((s, l) => s + l.onHand, 0)).toBe(31);
    expect(layers.find(l => l.lot === "L-7")).toMatchObject({ quantity: 12, unitCost: 1.63 });
  });

  it("no registra dos veces la misma factura, aunque la primera compra esté cancelada", async () => {
    const f = await setup();
    const first = await supplyService.savePurchase(undefined, purchaseInput(f, { ...fitlabDocument, accessKey: "", number: "002-100-000008888" }));
    await expect(supplyService.savePurchase(undefined, purchaseInput(f, { ...fitlabDocument, accessKey: "", number: "002-100-000008888" }))).rejects.toThrow(new RegExp(`ya está registrada en la compra ${first.number}`));
    await supplyService.changePurchase(first.id, "CANCELLED", first.revision);
    await expect(supplyService.savePurchase(undefined, purchaseInput(f, { ...fitlabDocument, accessKey: "", number: "002-100-000008888" }))).rejects.toThrow(/cancelada/);
  });

  it("rechaza un RUC distinto al del proveedor y líneas que mezclan modos", async () => {
    const f = await setup("1790000000001");
    await expect(supplyService.savePurchase(undefined, purchaseInput(f))).rejects.toThrow(/no coincide con el del proveedor/);
    const g = await setup();
    const mixed = purchaseInput(g); mixed.items[0] = { ...mixed.items[0]!, unitCost: 39.1 } as never;
    await expect(supplyService.savePurchase(undefined, mixed)).rejects.toThrow(/Línea 1: con factura/);
    await expect(supplyService.savePurchase(undefined, { supplierId: g.supplierId, warehouseId: "main", items: [{ productId: g.productId, sku: g.sku, quantity: 1, netUnitCost: "1.00", netTotal: "1.00", lot: "X", expiresOn: "2090-01-01" }] })).rejects.toThrow(/Línea 1: indica el costo unitario/);
  });

  it("al quitar la factura de un borrador se borra su identidad documental", async () => {
    const f = await setup();
    const draft = await supplyService.savePurchase(undefined, purchaseInput(f, { ...fitlabDocument, accessKey: "", number: "002-100-000009999" }));
    const plain = await supplyService.savePurchase(draft.id, { supplierId: f.supplierId, warehouseId: "main", items: [{ productId: f.productId, sku: f.sku, quantity: 4, unitCost: 21.756521, lot: "X", expiresOn: "2090-01-01" }] }, draft.revision);
    expect(plain.documentKey).toBeUndefined();
    expect(plain.total).toBe(87.03);
  });
});
