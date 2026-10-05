import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { unitOfWork, operationContext, afterCommit } from "../lib/unitOfWork.js";

const schema = new mongoose.Schema({
  operationId: { type: String, index: true }, requestId: { type: String, index: true }, actorId: String, actorEmail: String, ip: String,
  action: { type: String, index: true }, entity: { type: String, index: true }, entityId: { type: String, index: true },
  status: { type: String, enum: ["STARTED", "SUCCESS", "FAILED"], index: true },
  before: mongoose.Schema.Types.Mixed, after: mongoose.Schema.Types.Mixed, input: mongoose.Schema.Types.Mixed,
  relatedEntityIds: { type: [String], index: true },
  error: String, createdAt: { type: Date, default: Date.now, index: true },
  // Fecha en que MongoDB borra el evento (C60, S15): la bitácora guarda datos personales y
  // la LOPDP pide un plazo. Campo aparte porque createdAt ya tiene un índice sin caducidad.
  expiresAt: Date
}, { strict: true });
schema.index({ entity: 1, entityId: 1, createdAt: -1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const retentionMs = () => env.AUDIT_RETENTION_DAYS * 86_400_000;
export const AuditModel = (mongoose.models.AuditEvent ?? mongoose.model("AuditEvent", schema)) as mongoose.Model<mongoose.InferSchemaType<typeof schema>>;
export type AuditContext = { user?: { id: string; email: string } | null; requestId?: string; ip?: string };
export const auditFilters = z.object({
  search: z.string().max(120).default(""), entity: z.string().max(50).default(""),
  status: z.enum(["", "STARTED", "SUCCESS", "FAILED", "RESULT", "UNRESOLVED"]).default(""),
  scope: z.enum(["ALL", "OPERATIONS", "ACCESS"]).default("ALL"),
  from: z.string().datetime().optional(), to: z.string().datetime().optional(),
  offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(30)
});
// Do not retain secrets, binary uploads or authentication tokens in the journal.
export function redact(value: unknown): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return "[BINARY]";
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    if ("toHexString" in value) return String(value);
    if ("toObject" in value && typeof value.toObject === "function") return redact(value.toObject());
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, /password|token|secret|authorization|credential|resetHash|requestKey|requestFingerprint|idempotencyKey|idNumber|otpauth|recoveryCodes|totp|^code$/i.test(key) ? "[REDACTED]" : redact(entry)]));
  }
  return value;
}
type Event = { operationId?: string; id: string; requestId: string; actorId: string; actorEmail: string; ip: string; action: string; entity: string; entityId: string; status: string; before?: unknown; after?: unknown; input?: unknown; error?: string; createdAt: string; relatedEntityIds?: string[] };
type RunOptions<T> = { transactional?: boolean; snapshot?: (result?: T) => Promise<unknown> };
class AuditService {
  private memory: Event[] = [];
  /** Pone fecha de borrado a los eventos anteriores a la conservación (idempotente; al arrancar). */
  async applyRetention() {
    if (mongoose.connection.readyState !== 1) return 0;
    const result = await AuditModel.updateMany({ expiresAt: { $exists: false } }, [{ $set: { expiresAt: { $add: ["$createdAt", retentionMs()] } } }]);
    return result.modifiedCount;
  }
  async record(event: Omit<Event, "id" | "createdAt">) {
    const row = { ...event, before: redact(event.before), after: redact(event.after), input: redact(event.input), id: randomUUID(), createdAt: new Date().toISOString() };
    if (mongoose.connection.readyState === 1) await AuditModel.create({ ...row, expiresAt: new Date(Date.now() + retentionMs()) });
    else if (operationContext.getStore()) afterCommit(() => { this.memory.unshift(row); });
    else this.memory.unshift(row);
    return row;
  }
  async run<T>(context: AuditContext, action: string, entity: string, entityId: string, input: unknown, before: unknown, work: () => Promise<T>, options: RunOptions<T> = {}): Promise<T> {
    const base = { operationId: randomUUID(), requestId: context.requestId ?? randomUUID(), actorId: context.user?.id ?? "anonymous", actorEmail: context.user?.email ?? "", ip: context.ip ?? "", action, entity, entityId, input: redact(input), before: redact(before) };
    // An intent must be durable before the business write. An unfinished intent remains visible if the process stops.
    await this.record({ ...base, status: "STARTED" });
    const complete = async (result: T) => {
      const record = result as { id?: unknown; _id?: unknown; user?: { id?: string; email?: string } } | null;
      if (action === "login" && record?.user?.id) {
        base.actorId = record.user.id;
        base.actorEmail = record.user.email ?? "";
      }
      const after = options.snapshot ? await options.snapshot(result) : redact(result);
      const relatedEntityIds = [...new Set([base.before, after].flatMap(value => {
        const records = (value as { records?: Array<{ id?: unknown; _id?: unknown }> } | null)?.records ?? [];
        return records.map(row => String(row.id ?? row._id ?? "")).filter(Boolean);
      }))];
      await this.record({ ...base, relatedEntityIds, entityId: entityId || String(record?.id ?? record?._id ?? record?.user?.id ?? ""), status: "SUCCESS", after });
    };
    let result: T;
    try {
      if (options.transactional) return await unitOfWork(async () => {
        base.before = options.snapshot ? redact(await options.snapshot()) : base.before;
        const output = await work();
        await complete(output); // The result and the business changes commit together.
        return output;
      }, { actorId: context.user?.id, requestId: base.requestId, reason: String((input as {input?: {reason?: string}})?.input?.reason ?? action) });
      base.before = options.snapshot ? redact(await options.snapshot()) : base.before;
      result = await work();
    }
    catch (error) {
      await this.record({ ...base, status: "FAILED", error: error instanceof Error ? error.message.replace(/scrypt[:$]\S+/g, "[REDACTED]").slice(0, 300) : "Error" });
      throw error;
    }
    try {
      await complete(result);
    } catch (error) {
      // Do not tell the caller to repeat a checkout which already succeeded.
      console.error("[audit] Resultado pendiente de conciliación", base.requestId);
    }
    return result;
  }
  async list(raw: unknown = {}): Promise<{rows: Event[]; total: number}> {
    const f = auditFilters.parse(raw);
    if (f.from && f.to && f.from > f.to) throw new Error("Rango de fechas inválido");
    if (mongoose.connection.readyState === 1) {
      const query: Record<string, unknown> = {};
      if (f.entity) query.entity = f.entity;
      if (f.status) query.status = f.status === "RESULT" ? { $in: ["SUCCESS", "FAILED"] } : f.status === "UNRESOLVED" ? "STARTED" : f.status;
      if (f.scope !== "ALL") query.action = { [f.scope === "ACCESS" ? "$regex" : "$not"]: /^read:/ };
      if (f.from || f.to) query.createdAt = { ...(f.from ? { $gte: new Date(f.from) } : {}), ...(f.to ? { $lte: new Date(f.to) } : {}) };
      if (f.search) {
        const pattern = new RegExp(f.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        query.$or = ["actorEmail", "actorId", "action", "entityId", "relatedEntityIds", "requestId", "operationId"].map((key) => ({ [key]: pattern }));
      }
      if (f.status === "UNRESOLVED") {
        const [result] = await AuditModel.aggregate([
          { $match: query },
          { $lookup: { from: AuditModel.collection.name, let: { operation: "$operationId" }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$operationId", "$$operation"] }, { $in: ["$status", ["SUCCESS", "FAILED"]] }] } } }, { $limit: 1 }], as: "results" } },
          { $match: { results: { $size: 0 } } },
          { $facet: { rows: [{ $sort: { createdAt: -1, _id: -1 } }, { $skip: f.offset }, { $limit: f.limit }, { $project: { results: 0 } }], total: [{ $count: "value" }] } }
        ]);
        return { rows: (result?.rows ?? []).map((row: {_id: unknown}) => ({ ...row, id: String(row._id) })) as Event[], total: result?.total[0]?.value ?? 0 };
      }
      const [rows, total] = await Promise.all([AuditModel.find(query).sort({ createdAt: -1, _id: -1 }).skip(f.offset).limit(f.limit).lean(), AuditModel.countDocuments(query)]);
      return { rows: rows.map((row) => redact({ ...row, id: String(row._id) })) as Event[], total };
    }
    const completed = new Set(this.memory.filter(row => row.status !== "STARTED").map(row => row.operationId));
    const rows = this.memory.filter((row) => (!f.entity || row.entity === f.entity) && (!f.status || (f.status === "RESULT" ? row.status !== "STARTED" : f.status === "UNRESOLVED" ? row.status === "STARTED" && !completed.has(row.operationId) : row.status === f.status)) && (f.scope === "ALL" || (f.scope === "ACCESS" ? row.action.startsWith("read:") : !row.action.startsWith("read:"))) && (!f.from || row.createdAt >= f.from) && (!f.to || row.createdAt <= f.to) && (!f.search || `${row.actorEmail} ${row.actorId} ${row.action} ${row.entityId} ${row.requestId} ${row.operationId} ${row.relatedEntityIds?.join(" ") ?? ""}`.toLowerCase().includes(f.search.toLowerCase())));
    return { rows: rows.slice(f.offset, f.offset + f.limit), total: rows.length };
  }
}
export const auditService = new AuditService();
