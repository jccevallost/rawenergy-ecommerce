import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { SupplierModel, WarehouseModel, PurchaseModel } from "../models/Supply.js";
import { operationContext, registerMemoryStore, unitOfWork } from "../lib/unitOfWork.js";
import { productService } from "./product.service.js";
import { orderService } from "./order.service.js";
import { authService } from "./auth.service.js";
import { normalizedLots, listMovements, type StockLot } from "./stockLedger.service.js";
const supplierSchema = z.object({ name: z.string().trim().min(2).max(120), contact: z.string().max(120).default(""), email: z.string().email().or(z.literal("")).default(""), phone: z.string().max(30).default(""), address: z.string().max(240).default(""), leadDays: z.number().int().min(0).max(365).default(7), active: z.boolean().default(true) }).strict();
const warehouseSchema = z.object({ name: z.string().trim().min(2).max(120), address: z.string().max(240).default(""), active: z.boolean().default(true) }).strict();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d).or(z.literal(""));
const purchaseSchema = z.object({ supplierId: z.string().min(1), warehouseId: z.string().min(1), expectedOn: date.default(""), notes: z.string().max(500).default(""), items: z.array(z.object({ productId: z.string().min(1), sku: z.string().min(3), quantity: z.number().int().min(1).max(100000), unitCost: z.number().positive().max(1000000), lot: z.string().trim().min(1).max(80), expiresOn: date.default("") }).strict()).min(1).max(100) }).strict();
type Supplier = z.infer<typeof supplierSchema> & { id: string };
type Warehouse = z.infer<typeof warehouseSchema> & { id: string };
type Purchase = Omit<z.infer<typeof purchaseSchema>, "items"> & { id: string; number: string; status: "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELLED"; total: number; revision: number; createdAt: string; receivedAt?: string; items: Array<z.infer<typeof purchaseSchema>["items"][number] & { title: string }> };
let suppliers: Supplier[] = []; let warehouses: Warehouse[] = [{ id: "main", name: "Bodega principal", address: "", active: true }]; let purchases: Purchase[] = [];
registerMemoryStore(() => ({ suppliers, warehouses, purchases }), (v) => { suppliers = v.suppliers; warehouses = v.warehouses; purchases = v.purchases; });
const mongo = () => mongoose.connection.readyState === 1;
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
    if (!input.active && (await this.purchases()).some((p) => p.supplierId === id && ["DRAFT", "ORDERED"].includes(p.status))) throw new Error("El proveedor tiene compras pendientes");
    const result = { ...input, id: id ?? randomUUID() };
    if (mongo()) await SupplierModel.updateOne({ _id: result.id }, { $set: input }, { upsert: !id });
    else if (id) suppliers = suppliers.map((r) => r.id === id ? result : r); else suppliers.push(result);
    return result;
  },
  async saveWarehouse(id: string | undefined, raw: unknown): Promise<Warehouse> {
    if (!operationContext.getStore()) return unitOfWork(() => this.saveWarehouse(id,raw));
    const input = warehouseSchema.parse(raw); const rows = await this.warehouses();
    if (id && !rows.some((r) => r.id === id)) throw new Error("Bodega no encontrada");
    if (!input.active && (id === "main" || (await this.positions()).some((l) => l.warehouseId === id && l.onHand > 0) || (await this.purchases()).some((p) => p.warehouseId === id && ["DRAFT", "ORDERED"].includes(p.status)))) throw new Error("La bodega principal, con stock, reservas o compras pendientes debe permanecer activa");
    const result = { ...input, id: id ?? randomUUID() };
    if (mongo()) await WarehouseModel.updateOne({ _id: result.id }, { $set: input }, { upsert: !id });
    else if (id) warehouses = warehouses.map((r) => r.id === id ? result : r); else warehouses.push(result);
    return result;
  },
  async savePurchase(id: string | undefined, raw: unknown, expectedRevision?: number): Promise<Purchase> {
    if (!operationContext.getStore()) return unitOfWork(() => this.savePurchase(id,raw,expectedRevision));
    const input = purchaseSchema.parse(raw);
    if (!(await this.suppliers()).some((s) => s.id === input.supplierId && s.active)) throw new Error("Selecciona un proveedor activo");
    if (!(await this.warehouses()).some((w) => w.id === input.warehouseId && w.active)) throw new Error("Selecciona una bodega activa");
    await this.lockWarehouses([input.warehouseId]);
    if (mongo()) {
      const locked = await SupplierModel.updateOne({ _id: input.supplierId, active: true }, { $inc: { accessRevision: 1 } });
      if (!locked.matchedCount) throw new Error("El proveedor ya no está activo.");
    }
    const current = id ? (await this.purchases()).find((p) => p.id === id) : null;
    if (id && (!current || current.status !== "DRAFT" || current.revision !== expectedRevision)) throw new Error("Solo puedes editar un borrador vigente. Recarga la compra.");
    const items = [];
    for (const item of input.items) {
      const product = await productService.get(item.productId);
      if (!product || product.active === false || !product.variants.some((v) => v.sku === item.sku)) throw new Error(`Variante no disponible: ${item.sku}`);
      if (item.expiresOn && item.expiresOn < new Date(Date.now()-5*3600000).toISOString().slice(0, 10)) throw new Error("El lote de compra no puede estar vencido");
      if (product.productType === "SUPPLEMENT" && !item.expiresOn) throw new Error(`Indica el vencimiento de ${item.sku}`);
      items.push({ ...item, title: product.title });
    }
    const result: Purchase = { ...input, items, id: id ?? randomUUID(), number: current?.number ?? `OC-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4)}`, status: "DRAFT", revision: (current?.revision ?? -1) + 1, total: Math.round(items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0) * 100) / 100, createdAt: current?.createdAt ?? new Date().toISOString() };
    if (mongo()) { const changed = await PurchaseModel.updateOne({ _id: result.id, ...(id ? { revision: expectedRevision, status: "DRAFT" } : {}) }, { $set: { ...result, _id: result.id } }, { upsert: !id }); if (id && !changed.matchedCount) throw new Error("La compra cambió. Recarga."); }
    else if (id) purchases = purchases.map((p) => p.id === id ? result : p); else purchases.unshift(result);
    return result;
  },
  async changePurchase(id: string, status: "ORDERED" | "RECEIVED" | "CANCELLED", revision: number): Promise<Purchase> {
    if (!operationContext.getStore()) return unitOfWork(() => this.changePurchase(id, status, revision));
    const current = (await this.purchases()).find((p) => p.id === id);
    if (!current) throw new Error("Compra no encontrada");
    if (current.status === status) return current;
    if (current.revision !== revision || current.status === "RECEIVED" || current.status === "CANCELLED" || status === "RECEIVED" && current.status !== "ORDERED") throw new Error("Transición no permitida. Recarga la compra.");
    if (status === "RECEIVED") for (const item of current.items) {
      if (item.expiresOn && item.expiresOn < new Date(Date.now()-5*3600000).toISOString().slice(0, 10)) throw new Error("No puedes recibir un lote vencido");
      await productService.changeStock(item.productId, item.sku, item.quantity, { warehouseId: current.warehouseId, lot: item.lot, expiresOn: item.expiresOn, unitCost: item.unitCost, reason: `Recepción ${current.number}` });
    }
    const result = { ...current, status, revision: revision + 1, ...(status === "RECEIVED" ? { receivedAt: new Date().toISOString() } : {}) };
    if (mongo()) { const updated = await PurchaseModel.updateOne({ _id: id, revision, status: current.status }, { $set: result }); if (!updated.matchedCount) throw new Error("La compra cambió. Recarga."); }
    else purchases = purchases.map((p) => p.id === id ? result : p);
    return result;
  },
  async assertVariantsUnused(productId: string, skus: string[]) {
    if ((await this.purchases()).some(p => p.items.some(i => i.productId === productId && skus.includes(i.sku)))) throw new Error("Conserva los SKU que figuran en compras para mantener la trazabilidad.");
  },
  async positions() {
    const products = await productService.allForManagement();
    const reservations = await orderService.reservedPositions();
    const rows = products.flatMap((p) => p.variants.flatMap((v) => normalizedLots(v as unknown as { stock: number; lots?: StockLot[] }).map((lot) => ({ ...lot, productId: String("id" in p ? p.id : p._id), sku: v.sku, title: p.title, reserved: 0, available: lot.quantity, onHand: lot.quantity }))));
    const key = (r: {productId: string; sku: string; warehouseId?: string | null; lot?: string | null; expiresOn?: string | null; unitCost?: number | null}) => JSON.stringify([r.productId,r.sku,r.warehouseId,r.lot,r.expiresOn,r.unitCost]);
    const positions = new Map(rows.map(row => [key(row), row]));
    for (const reservation of reservations) {
      const row = positions.get(key(reservation)) ?? { ...reservation, warehouseId: reservation.warehouseId ?? "main", lot: reservation.lot ?? "INICIAL", expiresOn: reservation.expiresOn ?? "", unitCost: reservation.unitCost ?? null, quantity: 0, available: 0, reserved: 0, onHand: 0 };
      row.reserved += reservation.quantity ?? 0;
      row.onHand = row.available + row.reserved;
      positions.set(key(reservation), row);
    }
    return [...positions.values()];
  },
  async transfer(raw: unknown) {
    const f = z.object({ productId: z.string(), sku: z.string(), from: z.string(), to: z.string(), lot: z.string(), expiresOn:z.string().optional(), unitCost:z.number().nonnegative().nullable().optional(), expectedQuantity:z.number().int().nonnegative().optional(), quantity: z.number().int().positive().max(100000), reason: z.string().trim().min(5).max(300) }).strict().parse(raw);
    if (f.from === f.to || !(await this.warehouses()).some((w) => w.id === f.to && w.active)) throw new Error("Selecciona otra bodega activa");
    return unitOfWork(async () => {
      const product=await productService.get(f.productId),variant=product?.variants.find(v=>v.sku===f.sku);
      if(!variant)throw new Error("Variante no encontrada");
      const candidates=normalizedLots(variant as unknown as {stock:number;lots?:StockLot[]}).filter(l=>l.warehouseId===f.from&&l.lot===f.lot&&l.quantity>0);
      if((f.expiresOn===undefined)!==(f.unitCost===undefined))throw new Error("Indica juntos el vencimiento y el costo del lote.");
      if(f.expiresOn===undefined&&new Set(candidates.map(l=>JSON.stringify([l.expiresOn,l.unitCost]))).size>1)throw new Error("Hay varios lotes con ese nombre. Selecciona su vencimiento y costo.");
      const quantity=candidates.filter(l=>f.expiresOn===undefined||l.expiresOn===f.expiresOn&&l.unitCost===f.unitCost).reduce((sum,l)=>sum+l.quantity,0);
      if(f.expectedQuantity!==undefined&&quantity!==f.expectedQuantity)throw new Error("El lote cambió. Actualiza antes de trasladar.");
      const allocations = await productService.changeStock(f.productId, f.sku, -f.quantity, { warehouseId: f.from, lot: f.lot, reason: f.reason, allowExpired: true, ...(f.expiresOn!==undefined&&f.unitCost!==undefined?{position:{warehouseId:f.from,lot:f.lot,expiresOn:f.expiresOn,unitCost:f.unitCost}}:{}) }); await productService.changeStock(f.productId, f.sku, f.quantity, { exactLots: allocations.map((l) => ({ ...l, warehouseId: f.to })), reason: f.reason }); return { ...f, moved: true }; });
  },
  async overview() { return { suppliers: await this.suppliers(), warehouses: await this.warehouses(), purchases: await this.purchases(), positions: await this.positions() }; },
  async listMovements(filters: Parameters<typeof listMovements>[0]) {
    const result = await listMovements(filters);
    const names = new Map(await Promise.all([...new Set(result.rows.map(row => row.actorId).filter(Boolean))].map(async id => [id, (await authService.findUser(id!))?.name] as const)));
    return { ...result, rows: result.rows.map(row => ({ ...row, actorName: row.actorId === "system" ? "Sistema" : names.get(row.actorId) ?? "Usuario anterior" })) };
  }
};
