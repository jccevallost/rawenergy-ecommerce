// IMP-01: importación piloto de facturas en PDF (M10–M13, parcial).
//
// Flujo: subir PDF privado → leer en un hilo aislado → conciliar con decimales exactos → mostrar solo las
// excepciones → aprobar. Aprobar crea la compra en BORRADOR con la factura y las equivalencias elegidas; no
// toca el stock. La recepción sigue siendo un paso aparte con la fecha real. Un mismo PDF produce una sola
// importación y una factura ya registrada no se vuelve a registrar.
import { createHash } from "node:crypto";
import { z } from "zod";
import { ImportFileModel, PurchaseImportModel, SupplierAliasModel } from "../models/PurchaseImport.js";
import { PurchaseModel } from "../models/Supply.js";
import { operationContext, registerMemoryStore, unitOfWork } from "../lib/unitOfWork.js";
import { usesMongo } from "../lib/persistence.js";
import { extractPdfText } from "./pdfText.js";
import { parsePerseoInvoice, type InvoiceException, type ParsedLine, type TextItem } from "./invoiceParser.js";
import { documentKeyOf, reconcileInvoice } from "./purchaseDocument.js";
import { supplyService } from "./supply.service.js";
import { productService } from "./product.service.js";

type Status = "REQUIERE_REVISION" | "LISTO" | "REGISTRADO" | "FALLIDO" | "DESCARTADO";
export type ImportLine = ParsedLine & { productId?: string; sku?: string; title?: string; aliasApproved?: boolean; unitCost?: number; taxAllocated?: string };
export type PurchaseImport = {
  id: string; fileHash: string; status: Status; failure?: string; template?: string; parserVersion?: number;
  supplier?: { taxId: string; name: string; supplierId?: string; supplierName?: string };
  document?: { type: "FACTURA"; number: string; issuedOn: string; accessKey: string; subtotal: string; tax: string; total: string };
  totals?: Record<string, string>; additional?: Record<string, string>; lines: ImportLine[]; exceptions: InvoiceException[];
  reconciliation?: { ok: boolean; message?: string; total?: number; taxMethod?: string };
  documentKey?: string; purchaseId?: string; purchaseNumber?: string; createdBy: string; createdByName: string; discardReason?: string;
  revision: number; createdAt: string; updatedAt: string;
};
type Actor = { id: string; name: string };
type StoredFile = { id: string; data: Buffer; contentType: string; size: number };
type Alias = { id: string; supplierTaxId: string; code: string; productId: string; sku: string; description: string; approvedBy: string };

let imports: PurchaseImport[] = [], files: StoredFile[] = [], aliases: Alias[] = [];
registerMemoryStore(() => ({ imports, files, aliases }), v => { imports = v.imports; files = v.files; aliases = v.aliases; });
const mongo = usesMongo;
const normalize = (row: Record<string, unknown>) => ({ ...row, id: String(row._id ?? row.id), createdAt: new Date(row.createdAt as string).toISOString(), updatedAt: new Date(row.updatedAt as string).toISOString() }) as PurchaseImport;
/** Excepciones que se resuelven en la revisión eligiendo el producto; las demás impiden registrar. */
const resolvable = new Set(["SIN_EQUIVALENCIA", "DESCRIPCION_CAMBIO"]);

async function findAlias(taxId: string, code: string): Promise<Alias | null> {
  const id = `${taxId}:${code}`;
  if (mongo()) { const row = await SupplierAliasModel.findById(id).lean(); return row ? { ...(row as unknown as Alias), id } : null; }
  return aliases.find(a => a.id === id) ?? null;
}
async function existingPurchase(documentKey: string) {
  if (mongo()) return PurchaseModel.findOne({ documentKey }).select("number status").lean() as Promise<{ _id: string; number: string; status: string } | null>;
  const row = (await supplyService.purchases()).find(p => (p as { documentKey?: string }).documentKey === documentKey);
  return row ? { _id: row.id, number: row.number, status: row.status } : null;
}

/** Recalcula proveedor, equivalencias, duplicados y conciliación de una importación leída. */
async function review(record: PurchaseImport): Promise<PurchaseImport> {
  if (!record.document || !record.supplier) return record;
  const exceptions = record.exceptions.filter(e => !["SIN_EQUIVALENCIA", "DESCRIPCION_CAMBIO", "DUPLICADA", "CONCILIACION", "PROVEEDOR_NUEVO"].includes(e.code));
  const supplier = (await supplyService.suppliers()).find(s => (s as { taxId?: string }).taxId === record.supplier!.taxId);
  record.supplier = { taxId: record.supplier.taxId, name: record.supplier.name, ...(supplier ? { supplierId: supplier.id, supplierName: supplier.name } : {}) };
  if (!supplier) exceptions.push({ code: "PROVEEDOR_NUEVO", message: `No hay un proveedor con RUC ${record.supplier.taxId}. Al registrar se creará «${record.supplier.name}», o elige uno existente.` });
  for (const line of record.lines) {
    const alias = await findAlias(record.supplier.taxId, line.code);
    if (alias) {
      const product = await productService.get(alias.productId);
      Object.assign(line, { productId: alias.productId, sku: alias.sku, title: product?.title, aliasApproved: true });
      if (alias.description !== line.description) exceptions.push({ code: "DESCRIPCION_CAMBIO", line: line.index, message: `Línea ${line.index + 1}: la descripción cambió desde la equivalencia aprobada («${alias.description}»). Confirma que sigue siendo el mismo producto.` });
    } else exceptions.push({ code: "SIN_EQUIVALENCIA", line: line.index, message: `Línea ${line.index + 1} (${line.code}): elige el producto del catálogo. Se recordará para próximas facturas.` });
  }
  const documentKey = documentKeyOf({ supplierTaxId: record.supplier.taxId, type: "FACTURA", number: record.document.number });
  const duplicate = record.document.number ? await existingPurchase(documentKey) : null;
  if (duplicate && duplicate._id !== record.purchaseId) exceptions.push({ code: "DUPLICADA", message: `Esta factura ya está registrada en la compra ${duplicate.number}${duplicate.status === "CANCELLED" ? ", que está cancelada" : ""}.` });
  try {
    const result = reconcileInvoice({ ...record.document, supplierTaxId: record.supplier.taxId }, record.lines.map(l => ({ quantity: l.quantity, netUnitCost: l.netUnitCost, netTotal: l.netTotal, taxRate: 15 })));
    result.lines.forEach((derived, i) => Object.assign(record.lines[i]!, { unitCost: derived.unitCost, taxAllocated: derived.taxAllocated }));
    record.reconciliation = { ok: true, total: result.total, taxMethod: result.document.taxMethod };
  } catch (error) {
    record.reconciliation = { ok: false, message: (error as Error).message };
    exceptions.push({ code: "CONCILIACION", message: (error as Error).message });
  }
  record.exceptions = exceptions;
  record.documentKey = documentKey;
  if (record.status !== "REGISTRADO" && record.status !== "DESCARTADO") record.status = exceptions.length ? "REQUIERE_REVISION" : "LISTO";
  return record;
}

async function store(record: PurchaseImport, expectedRevision?: number) {
  if (mongo()) {
    const { id, createdAt: _c, updatedAt: _u, ...data } = record; void _c; void _u;
    if (expectedRevision === undefined) await PurchaseImportModel.create({ ...data, _id: id });
    else { const changed = await PurchaseImportModel.updateOne({ _id: id, revision: expectedRevision }, { $set: data }); if (!changed.matchedCount) throw new Error("La importación cambió. Recárgala."); }
  } else if (expectedRevision === undefined) imports.unshift(record);
  else imports = imports.map(i => i.id === record.id ? record : i);
}

export const purchaseImportService = {
  async get(id: string): Promise<PurchaseImport | null> {
    if (mongo()) { const row = await PurchaseImportModel.findById(z.string().max(80).parse(id)).lean(); return row ? normalize(row as unknown as Record<string, unknown>) : null; }
    return imports.find(i => i.id === id) ?? null;
  },
  async list(limit = 20): Promise<PurchaseImport[]> {
    if (mongo()) return (await PurchaseImportModel.find({}).sort({ createdAt: -1 }).limit(limit).lean()).map(r => normalize(r as unknown as Record<string, unknown>));
    return imports.slice(0, limit);
  },

  /** Guarda el PDF y su lectura. Repetir la subida del mismo archivo devuelve la importación existente. */
  async upload(data: Buffer, actor: Actor): Promise<{ record: PurchaseImport; existing: boolean }> {
    const hash = createHash("sha256").update(data).digest("hex");
    const previous = await this.get(`imp-${hash.slice(0, 32)}`);
    if (previous) return { record: await this.refresh(previous), existing: true };
    let text: { pages: TextItem[][] } | Error;
    try { text = await extractPdfText(data); } catch (error) { text = error as Error; }
    return this.ingest(hash, data, text, actor);
  },

  /** Crea la importación a partir del texto ya extraído (o del error de extracción). Las pruebas lo usan sin PDF. */
  async ingest(hash: string, data: Buffer, text: { pages: TextItem[][] } | Error, actor: Actor): Promise<{ record: PurchaseImport; existing: boolean }> {
    const id = `imp-${hash.slice(0, 32)}`;
    const previous = await this.get(id);
    if (previous) return { record: await this.refresh(previous), existing: true };
    const now = new Date().toISOString();
    const base: PurchaseImport = { id, fileHash: hash, status: "FALLIDO", lines: [], exceptions: [], createdBy: actor.id, createdByName: actor.name, revision: 0, createdAt: now, updatedAt: now };
    let record = base;
    try {
      if (text instanceof Error) throw text;
      const parsed = parsePerseoInvoice(text.pages[0] ?? []);
      if ("error" in parsed) record = { ...base, failure: parsed.error };
      else {
        record = { ...base, status: "REQUIERE_REVISION", template: parsed.template, parserVersion: parsed.parserVersion, supplier: parsed.supplier, document: parsed.document, totals: parsed.totals, additional: parsed.additional, lines: parsed.lines, exceptions: [...parsed.exceptions, ...(text.pages.length > 1 ? [{ code: "VARIAS_PAGINAS", message: "La factura tiene varias páginas; la importación piloto solo lee la primera." }] : [])] };
        record = await review(record);
      }
    } catch (error) { record = { ...base, failure: (error as Error).message }; }
    try {
      await unitOfWork(async () => {
        if (mongo()) await ImportFileModel.updateOne({ _id: hash }, { $setOnInsert: { _id: hash, contentType: "application/pdf", size: data.length, data, uploadedBy: actor.id } }, { upsert: true });
        else if (!files.some(f => f.id === hash)) files.push({ id: hash, data, contentType: "application/pdf", size: data.length });
        await store(record);
      }, { actorId: actor.id, reason: "Importación de factura" });
    } catch (error) {
      // Otra subida simultánea del mismo PDF ganó la carrera: se devuelve la suya.
      const winner = (error as { code?: number }).code === 11000 ? await this.get(id) : null;
      if (winner) return { record: winner, existing: true };
      throw error;
    }
    return { record, existing: false };
  },

  /** Vuelve a revisar proveedor, equivalencias y duplicados con los datos actuales, sin guardar. */
  async refresh(record: PurchaseImport) { return record.status === "REGISTRADO" || record.status === "DESCARTADO" || record.status === "FALLIDO" ? record : review(structuredClone(record)); },

  async file(id: string): Promise<StoredFile | null> {
    const record = await this.get(id);
    if (!record) return null;
    if (mongo()) { const row = await ImportFileModel.findById(record.fileHash).lean(); return row ? { id: record.fileHash, data: Buffer.from(row.data as unknown as Uint8Array), contentType: "application/pdf", size: row.size ?? 0 } : null; }
    return files.find(f => f.id === record.fileHash) ?? null;
  },

  /**
   * Registra la factura como compra en BORRADOR: guarda las equivalencias elegidas, crea el proveedor si
   * hace falta y deja el stock sin tocar. La clave de operación es la importación: repetir no crea otra compra.
   */
  async approve(id: string, revision: number, raw: unknown, actor: Actor): Promise<{ importId: string; purchaseId: string; purchaseNumber?: string; existing: boolean }> {
    if (!operationContext.getStore()) return unitOfWork(() => this.approve(id, revision, raw, actor), { actorId: actor.id, reason: "Registrar factura importada" });
    const input = z.object({
      warehouseId: z.string().min(1).max(80).default("main"),
      supplierId: z.string().min(1).max(80).optional(),
      lines: z.array(z.object({ index: z.number().int().min(0).max(99), productId: z.string().min(1).max(80), sku: z.string().min(3).max(80), lot: z.string().trim().max(80).default(""), expiresOn: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default("") }).strict()).min(1).max(100)
    }).strict().parse(raw);
    const stored = await this.get(id);
    if (!stored) throw new Error("Importación no encontrada.");
    if (stored.status === "REGISTRADO" && stored.purchaseId) return { importId: id, purchaseId: stored.purchaseId, purchaseNumber: stored.purchaseNumber, existing: true };
    if (stored.revision !== revision) throw new Error("La importación cambió. Recárgala.");
    if (stored.status === "FALLIDO" || stored.status === "DESCARTADO") throw new Error("Esta importación no se puede registrar.");
    const record = await review(structuredClone(stored));
    const blocking = record.exceptions.filter(e => !resolvable.has(e.code) && e.code !== "PROVEEDOR_NUEVO");
    if (blocking.length) throw new Error(`Resuelve antes: ${blocking.map(e => e.message).join(" ")}`);
    if (input.lines.length !== record.lines.length || record.lines.some(l => !input.lines.some(i => i.index === l.index))) throw new Error("Elige el producto de cada línea de la factura.");
    let supplierId = input.supplierId ?? record.supplier!.supplierId;
    if (supplierId) {
      const supplier = (await supplyService.suppliers()).find(s => s.id === supplierId);
      if (!supplier) throw new Error("Proveedor no encontrado.");
      const taxId = (supplier as { taxId?: string }).taxId;
      if (taxId && taxId !== record.supplier!.taxId) throw new Error(`El proveedor elegido tiene RUC ${taxId}, distinto del de la factura.`);
    } else supplierId = (await supplyService.saveSupplier(undefined, { name: record.supplier!.name.slice(0, 120) || `Proveedor ${record.supplier!.taxId}`, taxId: record.supplier!.taxId })).id;
    for (const line of record.lines) {
      const chosen = input.lines.find(i => i.index === line.index)!;
      const product = await productService.get(chosen.productId);
      if (!product || !product.variants.some(v => v.sku === chosen.sku)) throw new Error(`Línea ${line.index + 1}: la presentación elegida ya no existe.`);
      const alias: Alias = { id: `${record.supplier!.taxId}:${line.code}`, supplierTaxId: record.supplier!.taxId, code: line.code, productId: chosen.productId, sku: chosen.sku, description: line.description, approvedBy: actor.id };
      if (mongo()) await SupplierAliasModel.updateOne({ _id: alias.id }, { $set: { supplierTaxId: alias.supplierTaxId, code: alias.code, productId: alias.productId, sku: alias.sku, description: alias.description, approvedBy: alias.approvedBy } }, { upsert: true });
      else aliases = [...aliases.filter(a => a.id !== alias.id), alias];
    }
    const purchase = await supplyService.savePurchase(undefined, {
      supplierId, warehouseId: input.warehouseId, notes: `Importada desde PDF ${record.document!.number}`,
      document: { supplierTaxId: record.supplier!.taxId, number: record.document!.number, issuedOn: record.document!.issuedOn, accessKey: record.document!.accessKey, subtotal: record.document!.subtotal, tax: record.document!.tax, total: record.document!.total },
      // Lote del fabricante opcional (M32): sin él queda la marca «SIN-LOTE»; la capa interna identifica la recepción.
      items: record.lines.map(line => { const chosen = input.lines.find(i => i.index === line.index)!; return { productId: chosen.productId, sku: chosen.sku, quantity: line.quantity, netUnitCost: line.netUnitCost, netTotal: line.netTotal, taxRate: 15, lot: chosen.lot || "SIN-LOTE", expiresOn: chosen.expiresOn }; })
    }, undefined, { key: `import:${id}`, actorId: actor.id });
    const done: PurchaseImport = { ...record, status: "REGISTRADO", purchaseId: purchase.id, purchaseNumber: purchase.number, exceptions: [], revision: revision + 1, updatedAt: new Date().toISOString() };
    await store(done, revision);
    return { importId: id, purchaseId: purchase.id, purchaseNumber: purchase.number, existing: false };
  },

  async discard(id: string, revision: number, reason: string, actor: Actor): Promise<PurchaseImport> {
    if (!operationContext.getStore()) return unitOfWork(() => this.discard(id, revision, reason, actor), { actorId: actor.id, reason: "Descartar factura importada" });
    const text = z.string().trim().min(5).max(300).parse(reason);
    const stored = await this.get(id);
    if (!stored || stored.revision !== revision) throw new Error("La importación cambió. Recárgala.");
    if (stored.status === "REGISTRADO") throw new Error("Ya se registró como compra: cancela la compra si corresponde.");
    const done = { ...stored, status: "DESCARTADO" as const, discardReason: text, revision: revision + 1, updatedAt: new Date().toISOString() };
    await store(done, revision);
    return done;
  }
};
