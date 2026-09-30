import { AsyncLocalStorage } from "node:async_hooks";
import mongoose from "mongoose";

mongoose.set("transactionAsyncLocalStorage", true);
type Context = { actorId: string; requestId: string; reason: string; afterCommit: Array<() => void> };
export const operationContext = new AsyncLocalStorage<Context>();
const memoryStores: Array<{ snapshot: () => unknown; restore: (value: unknown) => void }> = [];
export function registerMemoryStore<T>(snapshot: () => T, restore: (value: T) => void) { memoryStores.push({ snapshot, restore: (value) => restore(value as T) }); }
let tail = Promise.resolve();
function flush(context: Context) { for(const run of context.afterCommit) { try { run(); } catch(error) { console.error("[afterCommit] No se pudo completar una notificación",error); } } }
export function afterCommit(work: () => void) { const context = operationContext.getStore(); if (context) context.afterCommit.push(work); else work(); }
export async function unitOfWork<T>(work: () => Promise<T>, metadata: Partial<Omit<Context, "afterCommit">> = {}): Promise<T> {
  if (operationContext.getStore()) return work();
  const context: Context = { actorId: metadata.actorId ?? "system", requestId: metadata.requestId ?? crypto.randomUUID(), reason: metadata.reason ?? "Operación del sistema", afterCommit: [] };
  if (mongoose.connection.readyState === 1) {
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await mongoose.connection.transaction(async () => {
          context.afterCommit = []; // The driver may retry the transaction.
          return operationContext.run(context, work);
        });
        flush(context);
        return result;
      } catch (error) {
        // A concurrent checkout can win the unique request key. Read its
        // committed result in a fresh transaction; never retry an aborted one.
        const conflict = error as { code?: number; keyPattern?: { requestKey?: number } };
        if (attempt >= 2 || conflict.code !== 11000 || !conflict.keyPattern?.requestKey) throw error;
      }
    }
  }
  const previous = tail; let unlock!: () => void;
  tail = new Promise<void>((resolve) => { unlock = resolve; });
  await previous;
  const snapshots = memoryStores.map((store) => structuredClone(store.snapshot()));
  let result: T;
  try { result = await operationContext.run(context, work); }
  catch (error) { memoryStores.forEach((store, i) => store.restore(snapshots[i])); throw error; }
  finally { unlock(); }
  flush(context);
  return result;
}
