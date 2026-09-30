import mongoose from "mongoose";
import { z } from "zod";
import { operationContext, registerMemoryStore, unitOfWork } from "../lib/unitOfWork.js";

export const expenseCategories = ["ADVERTISING", "PAYROLL", "TRANSPORT", "RENT", "UTILITIES", "FEES", "INVENTORY_LOSS", "OTHER"] as const;
const today = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
const inputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v && v <= today(), "Usa una fecha válida hasta hoy"),
  category: z.enum(expenseCategories),
  amount: z.number().positive().max(1_000_000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.000001, "Usa hasta dos decimales"),
  description: z.string().trim().min(5).max(300),
  reference: z.string().trim().max(120).default("")
}).strict();
type Actor = { id: string; name: string };
export type Expense = z.infer<typeof inputSchema> & { id: string; status: "ACTIVE" | "VOID"; revision: number; createdBy: string; createdByName: string; updatedBy: string; updatedByName: string; voidReason: string; createdAt: string; updatedAt: string };
const schema = new mongoose.Schema({
  _id: String, date: { type: String, required: true }, category: { type: String, enum: expenseCategories, required: true }, amount: { type: Number, required: true }, description: String, reference: String,
  status: { type: String, enum: ["ACTIVE", "VOID"], default: "ACTIVE" }, revision: { type: Number, default: 0 },
  createdBy: String, createdByName: String, updatedBy: String, updatedByName: String, voidReason: String
}, { timestamps: true });
schema.index({ status: 1, date: -1 });
export const ExpenseModel = (mongoose.models.Expense ?? mongoose.model("Expense", schema)) as mongoose.Model<mongoose.InferSchemaType<typeof schema>>;
let memory: Expense[] = [];
registerMemoryStore(() => memory, value => { memory = value; });
const mongo = () => mongoose.connection.readyState === 1;
const normalize = (value: any): Expense => ({ ...value, id: String(value._id ?? value.id), createdAt: new Date(value.createdAt).toISOString(), updatedAt: new Date(value.updatedAt).toISOString() });
const sameInput = (a: Expense, b: z.infer<typeof inputSchema>) => Object.entries(b).every(([key, value]) => a[key as keyof Expense] === value);

export const expenseService = {
  async get(id: string): Promise<Expense | null> {
    const row = mongo() ? await ExpenseModel.findById(id).lean() : memory.find(e => e.id === id);
    return row ? normalize(row) : null;
  },
  async forPeriod(from: string, to: string): Promise<Expense[]> {
    const upper = today() < to ? today() : to;
    if (mongo()) return (await ExpenseModel.find({ status: "ACTIVE", date: { $gte: from, $lt: to, $lte: upper } }).lean()).map(normalize);
    return memory.filter(e => e.status === "ACTIVE" && e.date >= from && e.date < to && e.date <= upper);
  },
  async list(raw: unknown) {
    const f = z.object({ year: z.number().int().min(2020).max(2100).optional(), month: z.number().int().min(0).max(12).default(0), status: z.enum(["ACTIVE", "VOID", "ALL"]).default("ACTIVE"), search: z.string().max(120).default(""), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(20) }).refine(f => Boolean(f.year) || !f.month, "Indica el año para filtrar un mes").parse(raw);
    const prefix = f.year ? `${f.year}${f.month ? `-${String(f.month).padStart(2, "0")}` : ""}` : "";
    if (mongo()) {
      const term = f.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const filter = { date: { $regex: `^${prefix}` }, ...(f.status === "ALL" ? {} : { status: f.status }), ...(term ? { $or: [{ description: { $regex: term, $options: "i" } }, { reference: { $regex: term, $options: "i" } }] } : {}) };
      const [rows, total, sum] = await Promise.all([ExpenseModel.find(filter).sort({ date: -1, createdAt: -1, _id: -1 }).skip(f.offset).limit(f.limit).lean(), ExpenseModel.countDocuments(filter), ExpenseModel.aggregate([{ $match: filter }, { $group: { _id: "$status", amount: { $sum: "$amount" } } }])]);
      return { rows: rows.map(normalize), total, activeAmount: Math.round((sum.find(r => r._id === "ACTIVE")?.amount ?? 0) * 100) / 100, voidAmount: Math.round((sum.find(r => r._id === "VOID")?.amount ?? 0) * 100) / 100 };
    }
    const rows = memory.filter(e => e.date.startsWith(prefix) && (f.status === "ALL" || e.status === f.status) && `${e.description} ${e.reference}`.toLowerCase().includes(f.search.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const sum = (status: string) => Math.round(rows.filter(e => e.status === status).reduce((s, e) => s + e.amount, 0) * 100) / 100;
    return { rows: rows.slice(f.offset, f.offset + f.limit), total: rows.length, activeAmount: sum("ACTIVE"), voidAmount: sum("VOID") };
  },
  async save(id: string, raw: unknown, revision: number | undefined, actor: Actor): Promise<Expense> {
    if (!operationContext.getStore()) return unitOfWork(() => this.save(id, raw, revision, actor));
    z.string().uuid().parse(id);
    const input = inputSchema.parse(raw), current = await this.get(id);
    if (revision === undefined && current) {
      if (current.revision === 0 && current.status === "ACTIVE" && current.createdBy === actor.id && sameInput(current, input)) return current;
      throw new Error("Este intento de registro ya fue utilizado. Actualiza la lista.");
    }
    if (revision !== undefined && (!current || current.status !== "ACTIVE" || current.revision !== revision)) throw new Error("El gasto cambió o fue anulado. Actualiza antes de editar.");
    const now = new Date().toISOString();
    const result: Expense = { ...input, id, status: "ACTIVE", revision: current ? current.revision + 1 : 0, createdBy: current?.createdBy ?? actor.id, createdByName: current?.createdByName ?? actor.name, updatedBy: actor.id, updatedByName: actor.name, voidReason: "", createdAt: current?.createdAt ?? now, updatedAt: now };
    if (mongo()) {
      if (!current) await ExpenseModel.create({ ...result, _id: id });
      else {
        const changed = await ExpenseModel.updateOne({ _id: id, revision, status: "ACTIVE" }, { $set: result });
        if (!changed.matchedCount) throw new Error("El gasto cambió. Actualiza antes de editar.");
      }
    } else if (current) memory = memory.map(e => e.id === id ? result : e); else memory.push(result);
    return result;
  },
  async void(id: string, revision: number, reason: string, actor: Actor): Promise<Expense> {
    if (!operationContext.getStore()) return unitOfWork(() => this.void(id, revision, reason, actor));
    const input = z.object({ id: z.string().uuid(), revision: z.number().int().nonnegative(), reason: z.string().trim().min(5).max(300) }).parse({ id, revision, reason });
    const current = await this.get(id);
    if (!current || current.revision !== input.revision || current.status !== "ACTIVE") throw new Error("El gasto cambió o ya fue anulado. Actualiza la lista.");
    const result: Expense = { ...current, status: "VOID", revision: current.revision + 1, voidReason: input.reason, updatedBy: actor.id, updatedByName: actor.name, updatedAt: new Date().toISOString() };
    if (mongo()) {
      const changed = await ExpenseModel.updateOne({ _id: id, revision, status: "ACTIVE" }, { $set: result });
      if (!changed.matchedCount) throw new Error("El gasto cambió. Actualiza la lista.");
    } else memory = memory.map(e => e.id === id ? result : e);
    return result;
  }
};
