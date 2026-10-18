// IMP-01: lectura de la factura FITLAB (texto anonimizado) e importación hasta compra en borrador, sin stock.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { parsePerseoInvoice, type TextItem } from "./invoiceParser.js";
import { purchaseImportService } from "./purchaseImport.service.js";
import { productService } from "./product.service.js";
import { supplyService } from "./supply.service.js";
import { extractPdfText } from "./pdfText.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/fitlab-factura-items.json", import.meta.url), "utf8")) as { items: TextItem[] };
const items = () => structuredClone(fixture.items);
const actor = { id: "jefa-de-tienda", name: "Jefa de tienda" };
const edit = (list: TextItem[], from: string, to: string) => list.map(i => i.str === from ? { ...i, str: to } : i);

describe("Lectura de la plantilla PERSEO (IMP-01)", () => {
  it("lee la factura FITLAB completa y sin excepciones", () => {
    const parsed = parsePerseoInvoice(items());
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.supplier).toEqual({ taxId: "1793213242001", name: "FITLAB SUPLEMENTOS S.A.S" });
    expect(parsed.document).toEqual({ type: "FACTURA", number: "002-100-000004199", issuedOn: "2026-10-13", accessKey: "1310202601179321324200120021000000041991234567812", subtotal: "431.69", tax: "64.75", total: "496.44" });
    expect(parsed.lines).toHaveLength(10);
    expect(parsed.lines.reduce((s, l) => s + l.quantity, 0)).toBe(31);
    expect(parsed.lines[1]).toMatchObject({ code: "DPH02", description: "Dragon Pharma Creatina 100serv/500gr", unit: "Unidad", quantity: 4, netUnitCost: "21.756521", netTotal: "87.03", discountPercent: 0 });
    expect(parsed.lines[7]).toMatchObject({ code: "77328", quantity: 12, netUnitCost: "1.417391", netTotal: "17.01" });
    expect(parsed.additional).toEqual({ rucProveedor: "1792765781001" });
    expect(parsed.exceptions).toEqual([]);
  });

  it("marca lo que no admite en lugar de interpretarlo", () => {
    const withDiscount = items().map(i => i.str === "0 %" && Math.round(i.y) === 511 ? { ...i, str: "5 %" } : i);
    const parsed = parsePerseoInvoice(withDiscount);
    expect("error" in parsed ? [] : parsed.exceptions.map(e => e.code)).toContain("DESCUENTO_LINEA");
    const zeroRate = items().map(i => i.str === "0,00" && Math.round(i.y) === 302 ? { ...i, str: "10,00" } : i);
    const second = parsePerseoInvoice(zeroRate);
    expect("error" in second ? [] : second.exceptions.map(e => e.message).join(" ")).toMatch(/IVA 0%/);
    expect(parsePerseoInvoice(items().filter(i => i.str !== "Código"))).toEqual({ error: expect.stringMatching(/no reconocido/) });
  });

  it("rechaza archivos que no son PDF antes de leerlos", async () => {
    await expect(extractPdfText(Buffer.from("<html>no es un pdf</html>"))).rejects.toThrow(/no es un PDF válido/);
  });
});

describe("Importación hasta compra en borrador (IMP-01)", () => {
  it("revisa excepciones, crea proveedor y equivalencias, registra la compra sin tocar el stock y no duplica", async () => {
    const payload = structuredClone(demoProducts[1]!); payload.slug = "importacion-1"; payload.variants = [{ ...payload.variants[0]!, stock: 7 }];
    const product = await productService.upsert(undefined, payload) as { id: string };
    const sku = payload.variants[0]!.sku;
    const { record } = await purchaseImportService.ingest("a".repeat(64), Buffer.from("%PDF-prueba"), { pages: [items()] }, actor);
    expect(record.status).toBe("REQUIERE_REVISION");
    expect(record.reconciliation).toMatchObject({ ok: true, total: 496.44, taxMethod: "GLOBAL" });
    expect(record.exceptions.filter(e => e.code === "SIN_EQUIVALENCIA")).toHaveLength(10);
    expect(record.exceptions.map(e => e.code)).toContain("PROVEEDOR_NUEVO");
    expect(record.lines.map(l => l.unitCost)).toEqual([39.1, 25.02, 24.24, 25.02, 35, 11.77, 21.9, 1.63, 9.39, 25]);

    const choice = record.lines.map(l => ({ index: l.index, productId: product.id, sku, lot: l.index === 0 ? "LOTE-ENVASE" : "", expiresOn: "2090-01-01" }));
    await expect(purchaseImportService.approve(record.id, record.revision, { lines: choice.slice(1) }, actor)).rejects.toThrow(/cada línea/);
    const done = await purchaseImportService.approve(record.id, record.revision, { lines: choice }, actor);
    const purchase = (await supplyService.purchases()).find(p => p.id === done.purchaseId)!;
    expect(purchase).toMatchObject({ status: "DRAFT", total: 496.44, documentKey: "1793213242001:FACTURA:002-100-000004199" });
    expect(purchase.items.map(i => i.lot)).toEqual(["LOTE-ENVASE", ...Array(9).fill("SIN-LOTE")]);
    expect((await supplyService.suppliers()).find(s => s.id === purchase.supplierId)).toMatchObject({ name: "FITLAB SUPLEMENTOS S.A.S", taxId: "1793213242001" });
    expect((await productService.get(product.id))!.variants[0]!.stock).toBe(7);

    expect(await purchaseImportService.approve(record.id, record.revision, { lines: choice }, actor)).toMatchObject({ purchaseId: done.purchaseId, existing: true });
    expect((await purchaseImportService.ingest("a".repeat(64), Buffer.from("%PDF-prueba"), { pages: [items()] }, actor)).existing).toBe(true);

    // Otro PDF del mismo comprobante: se detecta como factura ya registrada y no se puede registrar.
    const copy = await purchaseImportService.ingest("b".repeat(64), Buffer.from("%PDF-copia"), { pages: [items()] }, actor);
    expect(copy.record.exceptions.map(e => e.code)).toContain("DUPLICADA");
    await expect(purchaseImportService.approve(copy.record.id, copy.record.revision, { lines: choice }, actor)).rejects.toThrow(/ya está registrada/);

    // Una factura nueva del mismo proveedor reutiliza las equivalencias aprobadas y el proveedor creado.
    const next = edit(edit(items(), "002-100-000004199", "002-100-000004250"), "1310202601179321324200120021000000041991234567812", "x");
    const later = await purchaseImportService.ingest("c".repeat(64), Buffer.from("%PDF-siguiente"), { pages: [next] }, actor);
    expect(later.record.lines.every(l => l.aliasApproved && l.productId === product.id)).toBe(true);
    expect(later.record.exceptions).toEqual([]);
    expect(later.record.status).toBe("LISTO");
  });

  it("guarda como fallida una factura ilegible sin perder el archivo y permite descartarla con motivo", async () => {
    const { record } = await purchaseImportService.ingest("d".repeat(64), Buffer.from("%PDF-ilegible"), new Error("El PDF está protegido con contraseña."), actor);
    expect(record).toMatchObject({ status: "FALLIDO", failure: "El PDF está protegido con contraseña." });
    expect((await purchaseImportService.file(record.id))?.size).toBeGreaterThan(0);
    await expect(purchaseImportService.approve(record.id, 0, { lines: [{ index: 0, productId: "x", sku: "xxx" }] }, actor)).rejects.toThrow(/no se puede registrar/);
    expect((await purchaseImportService.discard(record.id, 0, "Factura protegida, se registra a mano", actor)).status).toBe("DESCARTADO");
  });
});
