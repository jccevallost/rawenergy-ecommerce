import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SupplierModel, WarehouseModel, PurchaseModel } from "../models/Supply.js";
import { operationContext, registerMemoryStore, unitOfWork } from "../lib/unitOfWork.js";
import { productService } from "./product.service.js";
import { orderService } from "./order.service.js";
import { authService } from "./auth.service.js";
import { normalizedLots, listMovements, type StockLot } from "./stockLedger.service.js";
import { layerPositions, type InventoryProduct, type ReservedLot } from "./inventoryPositions.js";
import { usesMongo } from "../lib/persistence.js";
import { contentFingerprint, scopedOperationKey } from "../lib/canonical.js";
import { assertUniqueIndex } from "../lib/indexes.js";
import { legacyTotal, reconcileInvoice, taxRates, type DerivedDocument } from "./purchaseDocument.js";
// RUC (13 dígitos) o cédula (10). Solo formato: no se consulta al SRI.
const taxId = z.string().trim().regex(/^(\d{10}|\d{13})?$/, "El RUC debe tener 13 dígitos (o 10 si es cédula).");
const supplierSchema = z.object({ name: z.string().trim().min(2).max(120), taxId: taxId.optional(), contact: z.string().max(120).default(""), email: z.string().email().or(z.literal("")).default(""), phone: z.string().max(30).default(""), address: z.string().max(240).default(""), leadDays: z.number().int().min(0).max(365).default(7), active: z.boolean().default(true) }).strict();
const warehouseSchema = z.object({ name: z.string().trim().min(2).max(120), address: z.string().max(240).default(""), active: z.boolean().default(true) }).strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d).or(z.literal(""));
// M05: con `document` cada línea trae el unitario sin IVA (hasta 6 decimales) y su total impreso; el
// servidor concilia y deriva el costo con IVA. Sin `document`, la línea trae `unitCost` como antes.
const amount = z.union([z.string().trim().max(20), z.number().nonnegative()]);
const documentSchema = z.object({ type: z.literal("FACTURA").default("FACTURA"), supplierTaxId: taxId.refine(v => v.length > 0, "Indica el RUC del proveedor."), number: z.string().trim().regex(/^\d{3}-\d{3}-\d{9}$/, "El número de factura tiene el formato 001-001-000000001."), issuedOn: date.refine(v => v.length > 0, "Indica la fecha de emisión."), accessKey: z.string().trim().regex(/^(\d{49})?$/, "La clave de acceso debe tener 49 dígitos.").default(""), subtotal: amount, tax: amount, total: amount }).strict();
const purchaseItemSchema = z.object({ productId: z.string().min(1), sku: z.string().min(3), quantity: z.number().int().min(1).max(100000), unitCost: z.number().positive().max(1000000).optional(), netUnitCost: amount.optional(), netTotal: amount.optional(), taxRate: z.union([z.literal(0), z.literal(5), z.literal(15)]).optional(), // M32: el lote del fabricante es opcional; sin él queda «SIN-LOTE» y la capa interna identifica la recepción.
  lot: z.string().trim().max(80).default("").transform(v => v || "SIN-LOTE"), expiresOn: date.default("") }).strict();
const purchaseSchema = z.object({ supplierId: z.string().min(1), warehouseId: z.string().min(1), expectedOn: date.default(""), notes: z.string().max(500).default(""), document: documentSchema.optional(), items: z.array(purchaseItemSchema).min(1).max(100) }).strict();
void taxRates;
type Supplier = z.infer<typeof supplierSchema> & { id: string };
type Warehouse = z.infer<typeof warehouseSchema> & { id: string };
type Receipt = { at: string; receivedOn: string; lines: Array<{ index: number; quantity: number }> };
type PurchaseLine = Omit<z.infer<typeof purchaseItemSchema>, "unitCost" | "netUnitCost" | "netTotal"> & { unitCost: number; receivedQuantity?: number; netUnitCost?: string; netTotal?: string; taxAllocated?: string; costWithTax?: string };
type Purchase = Omit<z.infer<typeof purchaseSchema>, "items" | "document"> & { document?: DerivedDocument["document"]; documentKey?: string; calculatedTotal?: number; id: string; number: string; requestKey?: string; requestFingerprint?: string; status: "DRAFT" | "ORDERED" | "PARTIAL" | "RECEIVED" | "CANCELLED"; total: number; receipts?: Receipt[]; shortages?: Array<{ index: number; quantity: number; value: number | null; reason: string }>; revision: number; createdAt: string; receivedAt?: string; receivedOn?: string; items: Array<PurchaseLine & { title: string }> };
let suppliers: Supplier[] = []; let warehouses: Warehouse[] = [{ id: "main", name: "Bodega principal", address: "", active: true }]; let purchases: Purchase[] = [];
registerMemoryStore(() => ({ suppliers, warehouses, purchases }), (v) => { suppliers = v.suppliers; warehouses = v.warehouses; purchases = v.purchases; });
const mongo = usesMongo;
export const supplyService = {
  async bootstrap() { if (mongo()) await WarehouseModel.updateOne({ _id: "main" }, { $setOnInsert: { _id: "main", name: "Bodega principal", active: true, address: "" } }, { upsert: true }); },
  async suppliers(): Promise<Supplier[]> { return mongo() ? (await SupplierModel.find({}).sort({ name: 1 }).lean()).map((r) => ({ ...r, id: r._id })) as Supplier[] : suppliers; },
  async warehouses(): Promise<Warehouse[]> { return mongo() ? (await WarehouseModel.find({}).sort({ name: 1 }).lean()).map((r) => ({ ...r, id: r._id })) as Warehouse[] : warehouses; },
  async lockWarehouses(ids: string[], allowInactive = false) {
    for (const id of [...new Set(ids)].sort()) {
      if (mongo()) {
        const result = await WarehouseModel.updateOne({ _id: id, ...(allowInactive ? {} : { active: true }) }, { $inc: { accessRevision: 1 } });
        if (!result.matchedCount) throw new Error("La bodega ya no está activa. Recarga el inventario.");
      } else if (!warehouses.some(w => w.id === id && (allowInactive || w.active))) throw new Error("La bodega ya no está activa. Recarga el inventario.");
    }
  },
  async purchases(status?: Purchase["status"]): Promise<Purchase[]> { return mongo() ? (await PurchaseModel.find(status ? {status} : {}).sort({ createdAt: -1 }).lean()).map((r) => ({ ...r, id: r._id })) as unknown as Purchase[] : purchases.filter(p=>!status||p.status===status); },
  async saveSupplier(id: string | undefined, raw: unknown): Promise<Supplier> {
    if (!operationContext.getStore()) return unitOfWork(() => this.saveSupplier(id,raw));
    const input = supplierSchema.parse(raw); const rows = await this.suppliers();
    if (id && !rows.some((r) => r.id === id)) throw new Error("Proveedor no encontrado");
    if (!input.active && (await this.purchases()).some((p) => p.supplierId === id && ["DRAFT", "ORDERED", "PARTIAL"].includes(p.status))) throw new Error("El proveedor tiene compras pendientes");
    const result = { ...input, id: id ?? randomUUID() };
    if (mongo()) await SupplierModel.updateOne({ _id: result.id }, { $set: input }, { upsert: !id });
    else if (id) suppliers = suppliers.map((r) => r.id === id ? { ...r, ...result } : r); else suppliers.push(result);
    return { ...(rows.find(r => r.id === id) ?? {}), ...result };
  },
  async saveWarehouse(id: string | undefined, raw: unknown): Promise<Warehouse> {
    if (!operationContext.getStore()) return unitOfWork(() => this.saveWarehouse(id,raw));
    const input = warehouseSchema.parse(raw); const rows = await this.warehouses();
    if (id && !rows.some((r) => r.id === id)) throw new Error("Bodega no encontrada");
    if (!input.active && (id === "main" || (await this.positions()).some((l) => l.warehouseId === id && l.onHand > 0) || (await this.purchases()).some((p) => p.warehouseId === id && ["DRAFT", "ORDERED", "PARTIAL"].includes(p.status)))) throw new Error("La bodega principal, con stock, reservas o compras pendientes debe permanecer activa");
    const result = { ...input, id: id ?? randomUUID() };
    if (mongo()) await WarehouseModel.updateOne({ _id: result.id }, { $set: input }, { upsert: !id });
    else if (id) warehouses = warehouses.map((r) => r.id === id ? result : r); else warehouses.push(result);
    return result;
  },
  /**
   * `operation` hace idempotente el alta (M35): la misma clave y el mismo contenido devuelven la compra
   * ya creada (reintento tras respuesta perdida o doble clic); la misma clave con otro contenido se
   * rechaza. La clave se limita a quien la usa y un índice único impide dos altas simultáneas.
   */
  async savePurchase(id: string | undefined, raw: unknown, expectedRevision?: number, operation?: { key?: string; actorId?: string }): Promise<Purchase> {
    if (!operationContext.getStore()) return unitOfWork(() => this.savePurchase(id,raw,expectedRevision,operation));
    const input = purchaseSchema.parse(raw);
    const key = !id && operation?.key ? z.string().trim().min(8).max(100).parse(operation.key) : undefined;
    const requestKey = key ? scopedOperationKey(operation?.actorId ?? operationContext.getStore()?.actorId ?? "system", key) : undefined;
    const requestFingerprint = requestKey ? contentFingerprint(input) : undefined;
    if (requestKey) {
      assertUniqueIndex("Purchase", "requestKey");
      const previous = mongo() ? (await PurchaseModel.findOne({ requestKey }).lean()) as unknown as (Purchase & { _id: string }) | null : purchases.find(p => p.requestKey === requestKey) ?? null;
      if (previous) {
        if (previous.requestFingerprint !== requestFingerprint) throw new Error("Este intento de compra ya se usó con otros datos. Revisa la compra anterior antes de crear otra.");
        return { ...previous, id: String("_id" in previous ? previous._id : previous.id) };
      }
    }
    if (!(await this.suppliers()).some((s) => s.id === input.supplierId && s.active)) throw new Error("Selecciona un proveedor activo");
    if (!(await this.warehouses()).some((w) => w.id === input.warehouseId && w.active)) throw new Error("Selecciona una bodega activa");
    await this.lockWarehouses([input.warehouseId]);
    if (mongo()) {
      const locked = await SupplierModel.updateOne({ _id: input.supplierId, active: true }, { $inc: { accessRevision: 1 } });
      if (!locked.matchedCount) throw new Error("El proveedor ya no está activo.");
    }
    const current = id ? (await this.purchases()).find((p) => p.id === id) : null;
    if (id && (!current || current.status !== "DRAFT" || current.revision !== expectedRevision)) throw new Error("Solo puedes editar un borrador vigente. Recarga la compra.");
    // M05: líneas coherentes con el modo elegido y factura conciliada antes de tocar nada más.
    input.items.forEach((item, i) => {
      if (input.document && (item.unitCost !== undefined || item.netUnitCost === undefined || item.netTotal === undefined)) throw new Error(`Línea ${i + 1}: con factura indica el unitario sin IVA y el total de la línea; el costo con IVA lo calcula el sistema.`);
      if (!input.document && (item.unitCost === undefined || item.netUnitCost !== undefined || item.netTotal !== undefined || item.taxRate !== undefined)) throw new Error(`Línea ${i + 1}: indica el costo unitario, o agrega los datos de la factura.`);
    });
    const reconciled = input.document ? reconcileInvoice(input.document, input.items.map(i => ({ quantity: i.quantity, netUnitCost: i.netUnitCost!, netTotal: i.netTotal!, taxRate: i.taxRate }))) : null;
    if (reconciled) {
      const supplier = (await this.suppliers()).find(s => s.id === input.supplierId);
      if (supplier?.taxId && supplier.taxId !== reconciled.document.supplierTaxId) throw new Error(`El RUC de la factura (${reconciled.document.supplierTaxId}) no coincide con el del proveedor (${supplier.taxId}).`);
      assertUniqueIndex("Purchase", "documentKey");
      const existing = mongo() ? await PurchaseModel.findOne({ documentKey: reconciled.documentKey, _id: { $ne: id ?? "" } }).select("number status").lean() : purchases.find(p => p.documentKey === reconciled.documentKey && p.id !== id);
      if (existing) throw new Error(`La factura ${reconciled.document.number} ya está registrada en la compra ${existing.number}${existing.status === "CANCELLED" ? ", que está cancelada" : ""}. Revisa esa compra antes de registrarla otra vez.`);
    }
    const items = [];
    for (const [index, raw] of input.items.entries()) {
      const derived = reconciled?.lines[index];
      const { netUnitCost: _net, netTotal: _total, ...rest } = raw; void _net; void _total;
      const item = derived ? { ...rest, ...derived } : { ...rest, unitCost: raw.unitCost! };
      const product = await productService.get(item.productId);
      if (!product || product.active === false || !product.variants.some((v) => v.sku === item.sku)) throw new Error(`Variante no disponible: ${item.sku}`);
      if (item.expiresOn && item.expiresOn < new Date(Date.now()-5*3600000).toISOString().slice(0, 10)) throw new Error("El lote de compra no puede estar vencido");
      if (product.productType === "SUPPLEMENT" && !item.expiresOn) throw new Error(`Indica el vencimiento de ${item.sku}`);
      items.push({ ...item, title: product.title });
    }
    const { document: _document, ...plain } = input; void _document;
    const result: Purchase = { ...plain, items, ...(reconciled ? { document: reconciled.document, documentKey: reconciled.documentKey, calculatedTotal: reconciled.calculatedTotal } : {}), ...(requestKey ? { requestKey, requestFingerprint } : current?.requestKey ? { requestKey: current.requestKey, requestFingerprint: current.requestFingerprint } : {}), id: id ?? randomUUID(), number: current?.number ?? `OC-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4)}`, status: "DRAFT", revision: (current?.revision ?? -1) + 1, total: reconciled ? reconciled.total : legacyTotal(items), createdAt: current?.createdAt ?? new Date().toISOString() };
    if (mongo()) { const changed = await PurchaseModel.updateOne({ _id: result.id, ...(id ? { revision: expectedRevision, status: "DRAFT" } : {}) }, { $set: { ...result, _id: result.id }, ...(reconciled ? {} : { $unset: { document: 1, documentKey: 1, calculatedTotal: 1 } }) }, { upsert: !id }); if (id && !changed.matchedCount) throw new Error("La compra cambió. Recarga."); }
    else if (id) purchases = purchases.map((p) => p.id === id ? result : p); else purchases.unshift(result);
    return result;
  },
  /** `receivedOn` es la fecha efectiva de recepción (M40). Recibir aquí es recibir todo lo pendiente (M14, M15). */
  async changePurchase(id: string, status: "ORDERED" | "RECEIVED" | "CANCELLED", revision: number, receivedOn?: string): Promise<Purchase> {
    if (!operationContext.getStore()) return unitOfWork(() => this.changePurchase(id, status, revision, receivedOn));
    const current = (await this.purchases()).find((p) => p.id === id);
    if (!current) throw new Error("Compra no encontrada");
    if (current.status === status) return current;
    if (status === "RECEIVED") return this.receive(id, revision, { receivedOn, lines: current.items.map((item, index) => ({ index, quantity: item.quantity - (item.receivedQuantity ?? 0) })).filter(l => l.quantity > 0) });
    if (current.revision !== revision || ["RECEIVED", "CANCELLED", "PARTIAL"].includes(current.status)) throw new Error(current.status === "PARTIAL" ? "La compra ya se recibió en parte: recibe el resto o ciérralo como faltante." : "Transición no permitida. Recarga la compra.");
    if (status === "ORDERED" && current.status !== "DRAFT") throw new Error("Transición no permitida. Recarga la compra.");
    const result = { ...current, status, revision: revision + 1 };
    if (mongo()) { const updated = await PurchaseModel.updateOne({ _id: id, revision, status: current.status }, { $set: result }); if (!updated.matchedCount) throw new Error("La compra cambió. Recarga."); }
    else purchases = purchases.map((p) => p.id === id ? result : p);
    return result;
  },

  /**
   * M15: recepción total o parcial. Cada línea recibe hasta lo pendiente; cada recepción crea su propia capa con su
   * fecha efectiva (la primera conserva la identidad P-<compra>-<línea>). Con `closeRemaining`, lo que no llegó se
   * cierra como faltante con su valor a costo y un motivo; el total de la factura no se toca.
   */
  async receive(id: string, revision: number, raw: { receivedOn?: string; lines: Array<{ index: number; quantity: number }>; closeRemaining?: boolean; reason?: string }): Promise<Purchase> {
    if (!operationContext.getStore()) return unitOfWork(() => this.receive(id, revision, raw));
    const input = z.object({ receivedOn: z.string().max(10).optional(), lines: z.array(z.object({ index: z.number().int().min(0).max(99), quantity: z.number().int().min(0).max(100000) }).strict()).max(100), closeRemaining: z.boolean().default(false), reason: z.string().trim().max(300).default("") }).strict().parse(raw);
    const today = new Date(Date.now()-5*3600000).toISOString().slice(0, 10);
    const effective = input.receivedOn ? date.parse(input.receivedOn) : today;
    if (!effective || effective > today || effective < new Date(Date.now()-5*3600000-366*86400000).toISOString().slice(0, 10)) throw new Error("La fecha de recepción no puede ser futura ni de hace más de un año.");
    const current = (await this.purchases()).find((p) => p.id === id);
    if (!current) throw new Error("Compra no encontrada");
    if (current.revision !== revision || !["DRAFT", "ORDERED", "PARTIAL"].includes(current.status)) throw new Error("Transición no permitida. Recarga la compra.");
    const receipts = current.receipts ?? [];
    const lines = input.lines.filter(l => l.quantity > 0);
    if (!lines.length && !input.closeRemaining) throw new Error("Indica cuántas unidades llegaron.");
    for (const line of lines) {
      const item = current.items[line.index];
      if (!item) throw new Error(`La compra no tiene la línea ${line.index + 1}.`);
      const pending = item.quantity - (item.receivedQuantity ?? 0);
      if (line.quantity > pending) throw new Error(`${item.title}: solo quedan ${pending} unidades por recibir.`);
      if (item.expiresOn && item.expiresOn < today) throw new Error("No puedes recibir un lote vencido");
      const previousReceipts = receipts.filter(r => r.lines.some(l => l.index === line.index && l.quantity > 0)).length;
      const layerId = previousReceipts ? `P-${current.id}-${line.index}-${previousReceipts + 1}` : `P-${current.id}-${line.index}`;
      await productService.changeStock(item.productId, item.sku, line.quantity, { exactLots: [{ warehouseId: current.warehouseId, lot: item.lot, expiresOn: item.expiresOn, unitCost: item.unitCost, quantity: line.quantity, layerId, receivedOn: effective, source: "PURCHASE", purchaseId: current.id, purchaseLine: line.index }], reason: `Recepción ${current.number}${previousReceipts || lines.length < current.items.length ? " (parcial)" : ""}` });
    }
    const items = current.items.map((item, index) => ({ ...item, receivedQuantity: (item.receivedQuantity ?? 0) + (lines.find(l => l.index === index)?.quantity ?? 0) }));
    const remaining = items.map((item, index) => ({ index, quantity: item.quantity - item.receivedQuantity })).filter(l => l.quantity > 0);
    if (input.closeRemaining && remaining.length && input.reason.length < 5) throw new Error("Explica por qué se cierran las unidades que no llegaron (por ejemplo: faltante, nota de crédito pendiente).");
    const shortages = input.closeRemaining ? [...(current.shortages ?? []), ...remaining.map(r => ({ index: r.index, quantity: r.quantity, value: Math.round(r.quantity * items[r.index]!.unitCost * 100) / 100, reason: input.reason }))] : current.shortages;
    const complete = !remaining.length || input.closeRemaining;
    const result: Purchase = { ...current, items, status: complete ? "RECEIVED" : "PARTIAL", revision: revision + 1, receipts: lines.length ? [...receipts, { at: new Date().toISOString(), receivedOn: effective, lines }] : receipts, ...(shortages ? { shortages } : {}), ...(complete ? { receivedAt: new Date().toISOString() } : {}), receivedOn: current.receivedOn ?? effective };
    if (mongo()) { const updated = await PurchaseModel.updateOne({ _id: id, revision, status: current.status }, { $set: result }); if (!updated.matchedCount) throw new Error("La compra cambió. Recarga."); }
    else purchases = purchases.map((p) => p.id === id ? result : p);
    return result;
  },

  /** Mercadería en camino: compras confirmadas y lo pendiente de las recibidas en parte. */
  async inTransit() {
    return (await this.purchases()).filter(p => p.status === "ORDERED" || p.status === "PARTIAL").map(p => ({ ...p, items: p.items.map(i => ({ ...i, quantity: i.quantity - (i.receivedQuantity ?? 0) })).filter(i => i.quantity > 0) }));
  },
  async assertVariantsUnused(productId: string, skus: string[]) {
    if ((await this.purchases()).some(p => p.items.some(i => i.productId === productId && skus.includes(i.sku)))) throw new Error("Conserva los SKU que figuran en compras para mantener la trazabilidad.");
  },
  /** Existencias por capa y bodega (M41): físicas = sin reservar + reservadas. */
  async positions() {
    const products = await productService.allForManagement();
    const reservations = await orderService.reservedPositions();
    return layerPositions(products as unknown as InventoryProduct[], reservations as unknown as ReservedLot[]);
  },
  async transfer(raw: unknown) {
    const f = z.object({ productId: z.string(), sku: z.string(), from: z.string(), to: z.string(), lot: z.string(), layerId: z.string().min(1).max(120).optional(), expiresOn:z.string().optional(), unitCost:z.number().nonnegative().nullable().optional(), expectedQuantity:z.number().int().nonnegative().optional(), quantity: z.number().int().positive().max(100000), reason: z.string().trim().min(5).max(300) }).strict().parse(raw);
    if (f.from === f.to || !(await this.warehouses()).some((w) => w.id === f.to && w.active)) throw new Error("Selecciona otra bodega activa");
    return unitOfWork(async () => {
      const product=await productService.get(f.productId),variant=product?.variants.find(v=>v.sku===f.sku);
      if(!variant)throw new Error("Variante no encontrada");
      const candidates=normalizedLots(variant as unknown as {stock:number;lots?:StockLot[]}).filter(l=>l.warehouseId===f.from&&l.lot===f.lot&&(!f.layerId||l.layerId===f.layerId)&&l.quantity>0);
      if((f.expiresOn===undefined)!==(f.unitCost===undefined))throw new Error("Indica juntos el vencimiento y el costo del lote.");
      const selected=candidates.filter(l=>f.expiresOn===undefined||l.expiresOn===f.expiresOn&&l.unitCost===f.unitCost);
      if(!f.layerId&&new Set(selected.map(l=>l.layerId)).size>1)throw new Error("Hay varios lotes con ese nombre. Actualiza el inventario y elige la fila exacta.");
      const quantity=selected.reduce((sum,l)=>sum+l.quantity,0);
      if(f.expectedQuantity!==undefined&&quantity!==f.expectedQuantity)throw new Error("El lote cambió. Actualiza antes de trasladar.");
      const allocations = await productService.changeStock(f.productId, f.sku, -f.quantity, { warehouseId: f.from, lot: f.lot, reason: f.reason, allowExpired: true, ...(selected[0]?{position:{warehouseId:f.from,lot:f.lot,expiresOn:selected[0].expiresOn,unitCost:selected[0].unitCost,layerId:selected[0].layerId}}:{}) }); await productService.changeStock(f.productId, f.sku, f.quantity, { exactLots: allocations.map((l) => ({ ...l, warehouseId: f.to })), reason: f.reason }); return { ...f, moved: true }; });
  },
  async overview() { return { suppliers: await this.suppliers(), warehouses: await this.warehouses(), purchases: await this.purchases(), positions: await this.positions() }; },
  async listMovements(filters: Parameters<typeof listMovements>[0]) {
    const result = await listMovements(filters);
    const names = new Map(await Promise.all([...new Set(result.rows.map(row => row.actorId).filter(Boolean))].map(async id => [id, (await authService.findUser(id!))?.name] as const)));
    return { ...result, rows: result.rows.map(row => ({ ...row, actorName: row.actorId === "system" ? "Sistema" : names.get(row.actorId) ?? "Usuario anterior" })) };
  }
};
