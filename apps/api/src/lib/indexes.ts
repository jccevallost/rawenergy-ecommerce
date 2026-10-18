// M45: índices únicos efectivos. Declarar un índice en el esquema no garantiza que exista: Mongoose
// lo crea en segundo plano y, si hay duplicados previos, falla sin detener nada. Aquí se intenta crear
// cada índice, se verifica la lista real de índices y, si falta uno requerido, se informa de los
// valores repetidos sin borrarlos y se bloquean solo las altas que dependen de esa unicidad.
import mongoose from "mongoose";
import { usesMongo } from "./persistence.js";

export const requiredUniqueIndexes = [
  { model: "Order", field: "requestKey", purpose: "pedidos idempotentes" },
  { model: "Purchase", field: "requestKey", purpose: "compras idempotentes" },
  { model: "Purchase", field: "documentKey", purpose: "facturas sin duplicar" },
  { model: "SupplierExchange", field: "requestKey", purpose: "cambios con proveedor idempotentes" }
] as const;
export type IndexReport = {
  checkedAt: string; ok: boolean;
  failures: Array<{ model: string; error: string }>;
  missing: Array<{ model: string; field: string; purpose: string; collisions: Array<{ value: string; count: number }> }>;
};
let report: IndexReport | null = null;
export const indexReport = () => report;

export async function ensureIndexes(): Promise<IndexReport> {
  const failures: IndexReport["failures"] = [];
  // init() crea la colección (necesaria para transacciones) y queda memorizado; createIndexes() se
  // llama siempre para que cada verificación vuelva a intentar y registrar el error real.
  const results = await Promise.allSettled(Object.values(mongoose.models).map(async model => { await model.init().catch(() => undefined); await model.createIndexes(); }));
  results.forEach((result, i) => { if (result.status === "rejected") failures.push({ model: Object.values(mongoose.models)[i]!.modelName, error: String((result.reason as Error)?.message ?? result.reason).slice(0, 300) }); });
  const missing: IndexReport["missing"] = [];
  for (const required of requiredUniqueIndexes) {
    const model = mongoose.models[required.model];
    if (!model) { missing.push({ ...required, collisions: [] }); continue; }
    const indexes = await model.collection.indexes().catch(() => []);
    if (indexes.some(index => index.unique && Object.keys(index.key).length === 1 && index.key[required.field] === 1)) continue;
    // Informe de colisiones: valores repetidos que impiden crear el índice. No se borra nada.
    const collisions = await model.collection.aggregate<{ _id: unknown; count: number }>([
      { $match: { [required.field]: { $exists: true, $ne: null } } },
      { $group: { _id: `$${required.field}`, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }, { $sort: { count: -1 } }, { $limit: 20 }
    ]).toArray();
    missing.push({ ...required, collisions: collisions.map(c => ({ value: String(c._id).slice(0, 16), count: c.count })) });
  }
  report = { checkedAt: new Date().toISOString(), ok: !missing.length, failures, missing };
  if (!report.ok) console.error("[api] Faltan índices únicos requeridos. Las altas que dependen de ellos quedan bloqueadas hasta resolver los duplicados.", JSON.stringify(report));
  else if (failures.length) console.warn("[api] Algunos índices no se pudieron crear", JSON.stringify(failures));
  return report;
}

/** Bloquea una escritura que depende de un índice único cuya existencia no se pudo verificar. */
export function assertUniqueIndex(model: string, field: string) {
  if (!usesMongo() || !report) return;
  if (report.missing.some(m => m.model === model && m.field === field)) throw new Error("Esta operación está detenida temporalmente porque falta una protección contra duplicados en la base de datos. Avisa al administrador.");
}
