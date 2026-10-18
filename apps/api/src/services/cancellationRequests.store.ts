import { usesMongo } from "../lib/persistence.js";
import { registerMemoryStore } from "../lib/unitOfWork.js";
import { CancellationRequestModel } from "../models/CancellationRequest.js";

// CU12: almacenamiento de solicitudes de cancelación. Sin dependencias de servicios para que `order.service`
// pueda conciliarlas al cancelar por cualquier vía sin importar la lógica de solicitudes (evita ciclos).
export type CancellationRequest = {
  id: string; orderId: string; orderNumber: string; userId: string; reason: string; note: string;
  status: "PENDING" | "APPROVED" | "REJECTED"; publicNote: string; internalNote: string;
  decidedBy: string | null; decidedAt: string | null; revision: number; createdAt: string; updatedAt: string;
};

let memory: CancellationRequest[] = [];
registerMemoryStore(() => memory, value => { memory = value; });
const iso = (value: unknown) => value ? new Date(value as string | Date).toISOString() : null;
const normalize = (row: any): CancellationRequest => ({ ...row, id: String(row._id ?? row.id), decidedAt: iso(row.decidedAt), createdAt: iso(row.createdAt)!, updatedAt: iso(row.updatedAt)! });

export const cancellationStore = {
  async get(id: string) {
    if (usesMongo()) { const row = await CancellationRequestModel.findById(id).lean(); return row ? normalize(row) : null; }
    return memory.find(request => request.id === id) ?? null;
  },
  async pendingFor(orderId: string) {
    if (usesMongo()) { const row = await CancellationRequestModel.findOne({ orderId, status: "PENDING" }).lean(); return row ? normalize(row) : null; }
    return memory.find(request => request.orderId === orderId && request.status === "PENDING") ?? null;
  },
  /** La más reciente de cada pedido, para mostrarla al cliente. */
  async latestFor(orderIds: string[]) {
    const rows = usesMongo() ? (await CancellationRequestModel.find({ orderId: { $in: orderIds } }).sort({ createdAt: 1 }).lean()).map(normalize) : memory.filter(request => orderIds.includes(request.orderId));
    return new Map(rows.map(request => [request.orderId, request]));
  },
  async list(status: CancellationRequest["status"] | "ALL") {
    if (usesMongo()) return (await CancellationRequestModel.find(status === "ALL" ? {} : { status }).sort({ createdAt: 1 }).limit(200).lean()).map(normalize);
    return memory.filter(request => status === "ALL" || request.status === status).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  /** Crea la solicitud; si otra pendiente del mismo pedido ganó la carrera, devuelve null. */
  async create(request: Omit<CancellationRequest, "createdAt" | "updatedAt">) {
    if (usesMongo()) {
      try { await CancellationRequestModel.create([{ ...request, _id: request.id }]); }
      catch (error) { if ((error as { code?: number }).code === 11000) return null; throw error; }
      return this.get(request.id);
    }
    if (memory.some(other => other.orderId === request.orderId && other.status === "PENDING")) return null;
    const now = new Date().toISOString();
    const row = { ...request, createdAt: now, updatedAt: now };
    memory.push(row);
    return row;
  },
  /** Decide una solicitud pendiente con la revisión leída. false: ya cambió. */
  async decide(id: string, revision: number, patch: Pick<CancellationRequest, "status" | "publicNote" | "internalNote" | "decidedBy">) {
    const decidedAt = new Date();
    if (usesMongo()) {
      const result = await CancellationRequestModel.updateOne({ _id: id, status: "PENDING", revision }, { $set: { ...patch, decidedAt }, $inc: { revision: 1 } });
      return result.modifiedCount === 1;
    }
    const row = memory.find(request => request.id === id && request.status === "PENDING" && request.revision === revision);
    if (!row) return false;
    Object.assign(row, patch, { decidedAt: decidedAt.toISOString(), revision: row.revision + 1, updatedAt: decidedAt.toISOString() });
    return true;
  },
  /** Conciliación: un pedido cancelado por otra vía cierra su solicitud pendiente como aprobada. */
  async settlePending(orderId: string, publicNote: string) {
    const pending = await this.pendingFor(orderId);
    if (pending) await this.decide(pending.id, pending.revision, { status: "APPROVED", publicNote, internalNote: "Cerrada al cancelarse el pedido por otra vía.", decidedBy: "system" });
  }
};
