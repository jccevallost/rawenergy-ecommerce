import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { MovementModel } from "../models/Supply.js";
import { operationContext, registerMemoryStore } from "../lib/unitOfWork.js";
export type StockLot = { warehouseId: string; lot: string; expiresOn: string; quantity: number; unitCost: number | null };
export type StockMovement = { sequence?: number; id: string; productId: string; sku: string; title: string; delta: number; before: number; after: number; warehouseId: string; lot: string; expiresOn: string; unitCost: number | null; reason: string; actorId: string; requestId: string; createdAt: Date };
let memory: StockMovement[] = [];
let sequence = 0;
registerMemoryStore(() => memory, (value) => { memory = value; });
export const normalizedLots = (variant: { stock: number; lots?: StockLot[] }): StockLot[] => variant.lots?.length ? variant.lots.map((l) => ({ ...l })) : variant.stock ? [{ warehouseId: "main", lot: "INICIAL", expiresOn: "", quantity: variant.stock, unitCost: null }] : [];
export async function recordMovement(input: Omit<StockMovement, "id" | "actorId" | "requestId" | "reason" | "createdAt"> & { reason?: string }) {
  const ctx = operationContext.getStore();
  const row = { ...input, sequence: sequence = Math.max(sequence+1, Date.now()*1000), id: randomUUID(), actorId: ctx?.actorId ?? "system", requestId: ctx?.requestId ?? randomUUID(), reason: input.reason ?? ctx?.reason ?? "Ajuste de inventario", createdAt: new Date() };
  if (mongoose.connection.readyState === 1) await MovementModel.create({ ...row, _id: row.id }); else memory.unshift(row);
  return row;
}
export async function listMovements(filters: { productId?: string; sku?: string; search?: string; offset?: number; limit?: number } = {}) {
  const offset = filters.offset ?? 0, limit = filters.limit ?? 30;
  if (mongoose.connection.readyState === 1) {
    const query: Record<string, unknown> = {};
    if (filters.productId) query.productId = filters.productId;
    if (filters.sku) query.sku = filters.sku;
    if (filters.search) { const re = new RegExp(filters.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); query.$or = [{ sku: re }, { title: re }, { reason: re }]; }
    const total = await MovementModel.countDocuments(query);
    const rows = await MovementModel.find(query).sort({ createdAt: -1, sequence: -1, _id: -1 }).skip(offset).limit(limit).lean();
    return { total, rows: rows.map((r) => ({ ...r, id: r._id })) };
  }
  const rows = memory.filter((r) => (!filters.productId || r.productId === filters.productId) && (!filters.sku || r.sku === filters.sku) && (!filters.search || `${r.title} ${r.sku} ${r.reason}`.toLowerCase().includes(filters.search.toLowerCase())));
  return { total: rows.length, rows: rows.slice(offset, offset + limit) };
}

export async function movementHistory(until: Date, start?: Date): Promise<StockMovement[]> {
 if (start && until < start) return [];
 if (mongoose.connection.readyState===1) {
   const rows = await MovementModel.find({createdAt:{$lte:until,...(start?{$gte:start}:{})}}).sort({createdAt:1,sequence:1}).lean();
   const baseline = start ? await MovementModel.aggregate([
     {$match:{createdAt:{$lt:start}}}, {$sort:{createdAt:-1,sequence:-1,_id:-1}},
     {$group:{_id:{productId:"$productId",sku:"$sku"},row:{$first:"$$ROOT"}}}, {$replaceRoot:{newRoot:"$row"}}
   ]) : [];
   return [...baseline,...rows].map(r=>({...r,id:r._id})) as StockMovement[];
 }
 const rows=memory.filter(m=>m.createdAt<=until&&(!start||m.createdAt>=start));
 if(!start)return rows;
 const baseline=new Map<string,StockMovement>();
 for(const movement of memory) if(movement.createdAt<start) {
   const key=JSON.stringify([movement.productId,movement.sku]), previous=baseline.get(key);
   if(!previous||movement.createdAt>previous.createdAt||+movement.createdAt===+previous.createdAt&&(movement.sequence??0)>(previous.sequence??0))baseline.set(key,movement);
 }
 return [...baseline.values(),...rows];
}
