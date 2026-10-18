// CMB-01 (M31, M48): cambios de mercadería con el proveedor.
//
// Decisión del propietario (14/10/2026): al GENERAR el cambio las unidades se descuentan del inventario,
// porque las de reemplazo entrarán con otra factura. El valor que sale (costo con IVA de cada capa) queda
// «pendiente de reposición»: no es venta, costo de ventas ni pérdida. El reemplazo es una compra normal que
// se vincula al cambio; la diferencia de valor queda visible. Si el proveedor rechaza el cambio, las unidades
// vuelven a su capa original con su fecha de recepción. La política flexible de FITLAB (cambios mientras el
// producto esté sellado) no se generaliza: cada cambio confirma el sellado de sus unidades.
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { operationContext, registerMemoryStore, unitOfWork } from "../lib/unitOfWork.js";
import { usesMongo } from "../lib/persistence.js";
import { contentFingerprint, scopedOperationKey } from "../lib/canonical.js";
import { productService } from "./product.service.js";
import { supplyService } from "./supply.service.js";
import { normalizedLots, type StockLot } from "./stockLedger.service.js";
import { assertUniqueIndex } from "../lib/indexes.js";

export type ExchangeStatus = "ABIERTO" | "REPUESTO" | "CERRADO" | "CERRADO_CON_DIFERENCIA" | "ANULADO";
type ExchangeItem = { productId: string; sku: string; title: string; quantity: number; unitCost: number | null; value: number | null; lot: StockLot };
export type Exchange = {
  id: string; number: string; supplierId: string; supplierName: string; status: ExchangeStatus; sealedConfirmed: true;
  items: ExchangeItem[]; replacement: { productId?: string; sku?: string; title: string; quantity?: number; note: string };
  valueOut: number | null; replacements: Array<{ purchaseId: string; number: string; value: number }>; valueIn: number; difference: number | null;
  notes: string; closingNote?: string; voidReason?: string; requestKey?: string; requestFingerprint?: string;
  createdBy: string; createdByName: string; revision: number; createdAt: string; updatedAt: string;
};
type Actor = { id: string; name: string };

const schema = new mongoose.Schema({
  _id: String, number: String, supplierId: { type: String, index: true }, supplierName: String, status: { type: String, index: true }, sealedConfirmed: Boolean,
  items: mongoose.Schema.Types.Mixed, replacement: mongoose.Schema.Types.Mixed, valueOut: Number, replacements: mongoose.Schema.Types.Mixed, valueIn: Number, difference: Number,
  notes: String, closingNote: String, voidReason: String, requestKey: String, requestFingerprint: String, createdBy: String, createdByName: String, revision: { type: Number, default: 0 }
}, { timestamps: true, minimize: false });
// Una clave de operación genera un solo cambio, también con dos instancias de la API.
schema.index({ requestKey: 1 }, { unique: true, sparse: true });
export const ExchangeModel = (mongoose.models.SupplierExchange ?? mongoose.model("SupplierExchange", schema)) as mongoose.Model<mongoose.InferSchemaType<typeof schema>>;

let memory: Exchange[] = [];
registerMemoryStore(() => memory, v => { memory = v; });
const mongo = usesMongo;
const round2 = (n: number) => Math.round(n * 100) / 100;
const normalize = (row: Record<string, unknown>) => ({ ...row, id: String(row._id ?? row.id), createdAt: new Date(row.createdAt as string).toISOString(), updatedAt: new Date(row.updatedAt as string).toISOString() }) as Exchange;

const generateSchema = z.object({
  supplierId: z.string().min(1).max(80),
  sealedConfirmed: z.literal(true, { errorMap: () => ({ message: "Confirma que las unidades están selladas antes de generar el cambio." }) }),
  lines: z.array(z.object({ productId: z.string().min(1).max(80), sku: z.string().min(3).max(80), warehouseId: z.string().min(1).max(80), layerId: z.string().min(1).max(120), quantity: z.number().int().min(1).max(100000) }).strict()).min(1).max(30),
  replacement: z.object({ productId: z.string().min(1).max(80).optional(), sku: z.string().min(3).max(80).optional(), quantity: z.number().int().min(1).max(100000).optional(), note: z.string().trim().max(300).default("") }).strict().default({ note: "" }),
  notes: z.string().trim().max(500).default("")
}).strict();

async function save(row: Exchange, expectedRevision?: number) {
  if (mongo()) {
    const { id, createdAt: _c, updatedAt: _u, ...data } = row; void _c; void _u;
    if (expectedRevision === undefined) await ExchangeModel.create({ ...data, _id: id });
    else { const changed = await ExchangeModel.updateOne({ _id: id, revision: expectedRevision }, { $set: data }); if (!changed.matchedCount) throw new Error("El cambio fue modificado. Recárgalo."); }
  } else if (expectedRevision === undefined) memory.unshift(row);
  else memory = memory.map(e => e.id === row.id ? row : e);
}
const settle = (row: Exchange): Exchange => {
  const valueIn = round2(row.replacements.reduce((s, r) => s + r.value, 0));
  return { ...row, valueIn, difference: row.valueOut === null ? null : round2(row.valueOut - valueIn) };
};

export const exchangeService = {
  async get(id: string): Promise<Exchange | null> {
    if (mongo()) { const row = await ExchangeModel.findById(id).lean(); return row ? normalize(row as unknown as Record<string, unknown>) : null; }
    return memory.find(e => e.id === id) ?? null;
  },
  async list(status?: string): Promise<Exchange[]> {
    if (mongo()) return (await ExchangeModel.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(100).lean()).map(r => normalize(r as unknown as Record<string, unknown>));
    return memory.filter(e => !status || e.status === status).slice(0, 100);
  },
  /** Saldo con proveedores: valor salido en cambios abiertos menos lo ya repuesto. */
  async pendingBalance() {
    const open = (await this.list()).filter(e => e.status === "ABIERTO" || e.status === "REPUESTO");
    return { exchanges: open.length, units: open.reduce((s, e) => s + e.items.reduce((n, i) => n + i.quantity, 0), 0), pendingValue: round2(open.reduce((s, e) => s + (e.difference ?? 0), 0)), complete: open.every(e => e.valueOut !== null) };
  },

  /** Genera el cambio y descuenta en ese momento las unidades de cada capa. Repetir con la misma clave no descuenta otra vez. */
  async generate(raw: unknown, key: string, actor: Actor): Promise<Exchange> {
    if (!operationContext.getStore()) return unitOfWork(() => this.generate(raw, key, actor), { actorId: actor.id, reason: "Generar cambio con proveedor" });
    const input = generateSchema.parse(raw);
    assertUniqueIndex("SupplierExchange", "requestKey");
    const requestKey = scopedOperationKey(actor.id, z.string().trim().min(8).max(100).parse(key)), requestFingerprint = contentFingerprint(input);
    const previous = mongo() ? await ExchangeModel.findOne({ requestKey }).lean() : memory.find(e => e.requestKey === requestKey);
    if (previous) {
      const found = mongo() ? normalize(previous as unknown as Record<string, unknown>) : previous as Exchange;
      if (found.requestFingerprint !== requestFingerprint) throw new Error("Este intento de cambio ya se usó con otros datos. Revisa el cambio anterior.");
      return found;
    }
    const supplier = (await supplyService.suppliers()).find(s => s.id === input.supplierId);
    if (!supplier) throw new Error("Elige el proveedor del cambio.");
    const number = `CB-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4)}`;
    const items: ExchangeItem[] = [];
    for (const line of input.lines) {
      const product = await productService.get(line.productId);
      const variant = product?.variants.find(v => v.sku === line.sku);
      if (!product || !variant) throw new Error(`Producto no encontrado: ${line.sku}`);
      const lot = normalizedLots(variant as unknown as { stock: number; lots?: StockLot[] }).find(l => l.warehouseId === line.warehouseId && l.layerId === line.layerId);
      if (!lot || lot.quantity < line.quantity) throw new Error(`${product.title}: solo hay ${lot?.quantity ?? 0} unidades sin reservar en esa recepción. Las reservadas para pedidos no se envían al proveedor.`);
      await productService.changeStock(line.productId, line.sku, -line.quantity, { position: { warehouseId: lot.warehouseId, lot: lot.lot, expiresOn: lot.expiresOn, unitCost: lot.unitCost, layerId: lot.layerId }, allowExpired: true, reason: `Cambio a proveedor ${number}` });
      items.push({ productId: line.productId, sku: line.sku, title: product.title, quantity: line.quantity, unitCost: lot.unitCost, value: lot.unitCost === null ? null : round2(lot.unitCost * line.quantity), lot: { ...lot, quantity: line.quantity } });
    }
    let replacementTitle = input.replacement.note || "Por acordar";
    if (input.replacement.productId && input.replacement.sku) {
      const wanted = await productService.get(input.replacement.productId);
      if (!wanted || !wanted.variants.some(v => v.sku === input.replacement.sku)) throw new Error("El producto de reemplazo ya no existe.");
      replacementTitle = wanted.title;
    }
    const now = new Date().toISOString();
    const row = settle({
      id: randomUUID(), number, supplierId: supplier.id, supplierName: supplier.name, status: "ABIERTO", sealedConfirmed: true, items,
      replacement: { ...input.replacement, title: replacementTitle }, valueOut: items.every(i => i.value !== null) ? round2(items.reduce((s, i) => s + i.value!, 0)) : null,
      replacements: [], valueIn: 0, difference: null, notes: input.notes, requestKey, requestFingerprint, createdBy: actor.id, createdByName: actor.name, revision: 0, createdAt: now, updatedAt: now
    });
    await save(row);
    return row;
  },

  /** Vincula la compra de reemplazo (otra factura del mismo proveedor). */
  async linkReplacement(id: string, revision: number, purchaseId: string): Promise<Exchange> {
    if (!operationContext.getStore()) return unitOfWork(() => this.linkReplacement(id, revision, purchaseId));
    const row = await this.get(id);
    if (!row || row.revision !== revision) throw new Error("El cambio fue modificado. Recárgalo.");
    if (row.status !== "ABIERTO" && row.status !== "REPUESTO") throw new Error("Este cambio ya está cerrado o anulado.");
    const purchase = (await supplyService.purchases()).find(p => p.id === purchaseId);
    if (!purchase || purchase.status === "CANCELLED") throw new Error("Elige una compra vigente.");
    if (purchase.supplierId !== row.supplierId) throw new Error("La compra de reemplazo debe ser del mismo proveedor.");
    if (row.replacements.some(r => r.purchaseId === purchaseId)) return row;
    const used = (await this.list()).some(e => e.id !== id && e.status !== "ANULADO" && e.replacements.some(r => r.purchaseId === purchaseId));
    if (used) throw new Error("Esa compra ya está vinculada a otro cambio.");
    const next = settle({ ...row, status: "REPUESTO", replacements: [...row.replacements, { purchaseId, number: purchase.number, value: purchase.total }], revision: revision + 1, updatedAt: new Date().toISOString() });
    await save(next, revision);
    return next;
  },

  /** Cierra el cambio. Si queda diferencia de valor, se cierra explicándola. */
  async close(id: string, revision: number, note: string): Promise<Exchange> {
    if (!operationContext.getStore()) return unitOfWork(() => this.close(id, revision, note));
    const text = z.string().trim().max(300).parse(note);
    const row = await this.get(id);
    if (!row || row.revision !== revision) throw new Error("El cambio fue modificado. Recárgalo.");
    if (row.status !== "ABIERTO" && row.status !== "REPUESTO") throw new Error("Este cambio ya está cerrado o anulado.");
    const withDifference = row.difference === null || Math.abs(row.difference) >= 0.01;
    if (withDifference && text.length < 5) throw new Error("Queda una diferencia de valor: explica cómo se resolvió (nota de crédito, saldo a favor, otro acuerdo).");
    const next = { ...row, status: (withDifference ? "CERRADO_CON_DIFERENCIA" : "CERRADO") as ExchangeStatus, closingNote: text, revision: revision + 1, updatedAt: new Date().toISOString() };
    await save(next, revision);
    return next;
  },

  /** El proveedor rechazó el cambio: las unidades vuelven a su recepción original, con su fecha. */
  async void(id: string, revision: number, reason: string): Promise<Exchange> {
    if (!operationContext.getStore()) return unitOfWork(() => this.void(id, revision, reason));
    const text = z.string().trim().min(5).max(300).parse(reason);
    const row = await this.get(id);
    if (!row || row.revision !== revision) throw new Error("El cambio fue modificado. Recárgalo.");
    if (row.status !== "ABIERTO") throw new Error(row.replacements.length ? "Ya tiene reposición vinculada: ciérralo explicando la diferencia." : "Este cambio ya está cerrado o anulado.");
    const warehouses = await supplyService.warehouses();
    for (const item of row.items) {
      const target = warehouses.some(w => w.id === item.lot.warehouseId && w.active) ? item.lot.warehouseId : "main";
      await productService.changeStock(item.productId, item.sku, item.quantity, { exactLots: [{ ...item.lot, warehouseId: target, quantity: item.quantity }], reason: `Cambio ${row.number} anulado: ${text}${target !== item.lot.warehouseId ? "; destino principal por bodega archivada" : ""}` });
    }
    const next = { ...row, status: "ANULADO" as ExchangeStatus, voidReason: text, revision: revision + 1, updatedAt: new Date().toISOString() };
    await save(next, revision);
    return next;
  }
};
