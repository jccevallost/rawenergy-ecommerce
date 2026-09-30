import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import type { OrderStatus } from "../validation/order.js";
import { afterCommit, operationContext, registerMemoryStore, unitOfWork } from "../lib/unitOfWork.js";
import { mailService, type MailOrder } from "./mail.service.js";
import { telegramService } from "./telegram.service.js";

// Bandeja de salida de avisos (P05). Cada aviso se guarda en la misma
// transacción que el pedido o el cambio que lo origina, ya reservado por el
// proceso que confirma: tras el commit se envía al instante, como antes. Si el
// canal falla se reintenta con espera creciente; si el proceso muere antes de
// enviarlo, la reserva vence y el despachador periódico lo retoma al volver.
// Entrega «al menos una vez»: una caída justo después de enviar y antes de
// anotarlo puede repetir un aviso; nunca se pierde uno confirmado.
export type NotificationKind = "ORDER_CONFIRMATION" | "ORDER_OPERATOR_MAIL" | "ORDER_TELEGRAM" | "ORDER_STATUS_MAIL" | "OPERATOR_NOTICE";
type State = "SENDING" | "PENDING" | "SENT" | "SKIPPED" | "FAILED";
export type NotificationJob = {
  id: string; kind: NotificationKind; label: string; orderId?: string; status?: OrderStatus; text?: string;
  state: State; attempts: number; nextAttemptAt: Date; leaseUntil: Date | null; lastError: string; createdAt: Date; sentAt: Date | null;
};
type NewJob = Pick<NotificationJob, "kind" | "label" | "orderId" | "status" | "text">;

export const LEASE_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 6;
// Espera antes del intento 2, 3, …: 1 min, 5 min, 15 min, 1 h y 3 h (≈4 h 20 min en total).
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];
const KEEP_DONE_MS = 30 * 24 * 3600_000;

const schema = new mongoose.Schema({
  _id: String, kind: { type: String, required: true }, label: String, orderId: String, status: String, text: String,
  state: { type: String, required: true }, attempts: { type: Number, default: 0 }, nextAttemptAt: Date, leaseUntil: Date, lastError: String, sentAt: Date,
  // Los enviados u omitidos se borran solos a los 30 días.
  purgeAt: { type: Date, index: { expireAfterSeconds: 0 } }
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ state: 1, nextAttemptAt: 1 });
schema.index({ state: 1, leaseUntil: 1 });
export const NotificationModel = (mongoose.models.Notification ?? mongoose.model("Notification", schema, "notifications")) as mongoose.Model<mongoose.InferSchemaType<typeof schema>>;

let memory: NotificationJob[] = [];
registerMemoryStore(() => memory, value => { memory = value; });
const mongo = () => mongoose.connection.readyState === 1;
const fromDoc = (doc: Record<string, unknown>): NotificationJob => ({ ...(doc as unknown as NotificationJob), id: String(doc._id) });

type Channel = { enabled: () => boolean; send: (job: NotificationJob, order?: MailOrder) => Promise<boolean> };
const channels: Record<NotificationKind, Channel> = {
  ORDER_CONFIRMATION: { enabled: () => mailService.enabled, send: (_, order) => mailService.sendOrderConfirmation(order!) },
  ORDER_OPERATOR_MAIL: { enabled: () => mailService.enabled, send: (_, order) => mailService.sendOperatorAlert(order!) },
  ORDER_TELEGRAM: { enabled: () => telegramService.enabled, send: (_, order) => telegramService.sendOrderAlert(order!) },
  ORDER_STATUS_MAIL: { enabled: () => mailService.enabled, send: (job, order) => mailService.sendStatusUpdate({ ...order!, status: job.status! }) },
  OPERATOR_NOTICE: { enabled: () => telegramService.enabled, send: job => telegramService.sendNotice(job.text!) }
};

class NotificationOutbox {
  private loadOrder: (id: string) => Promise<MailOrder | null> = async () => null;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;
  private inFlight = new Set<Promise<void>>();

  /** order.service registra cómo leer un pedido; evita una importación circular. */
  useOrderLoader(loader: (id: string) => Promise<unknown>) { this.loadOrder = async id => (await loader(id)) as MailOrder | null; }

  /**
   * Guarda los avisos dentro de la unidad de trabajo actual. Si la operación se
   * revierte, los avisos desaparecen con ella; si se confirma, salen enseguida.
   * `order` es el pedido recién escrito, para no volver a leerlo en el envío inmediato.
   */
  async enqueue(items: NewJob[], order?: MailOrder): Promise<void> {
    if (!items.length) return;
    if (!operationContext.getStore()) return unitOfWork(() => this.enqueue(items, order));
    const now = new Date();
    const jobs: NotificationJob[] = items.map(item => ({ ...item, id: randomUUID(), state: "SENDING", attempts: 1, nextAttemptAt: now, leaseUntil: new Date(now.getTime() + LEASE_MS), lastError: "", createdAt: now, sentAt: null }));
    if (mongo()) await NotificationModel.insertMany(jobs.map(({ id, ...job }) => ({ _id: id, ...job })));
    else memory.push(...jobs);
    afterCommit(() => { for (const job of jobs) this.track(this.deliver(job, order)); });
  }

  /** Procesa los avisos vencidos: pendientes de reintento y reservas de procesos caídos. */
  run(now = new Date()): Promise<number> {
    if (this.running) return this.running;
    this.running = (async () => {
      let processed = 0;
      for (; processed < 50; processed++) {
        const job = await this.claim(now);
        if (!job) break;
        await this.deliver(job);
      }
      await this.purge(now);
      return processed;
    })().finally(() => { this.running = null; });
    return this.running;
  }

  /** Espera los envíos inmediatos en curso (pruebas y apagado ordenado). */
  async drain() { while (this.inFlight.size) await Promise.allSettled([...this.inFlight]); }

  start(intervalMs = 30_000) {
    if (this.timer) return;
    void this.run().catch(error => console.error("[avisos] no se pudo revisar la bandeja", error));
    this.timer = setInterval(() => { void this.run().catch(error => console.error("[avisos] no se pudo revisar la bandeja", error)); }, intervalMs);
    this.timer.unref();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async summary() {
    const counts = { PENDING: 0, SENDING: 0, FAILED: 0 } as Record<"PENDING" | "SENDING" | "FAILED", number>;
    let failures: NotificationJob[];
    if (mongo()) {
      const rows = await NotificationModel.aggregate<{ _id: keyof typeof counts; n: number }>([{ $match: { state: { $in: Object.keys(counts) } } }, { $group: { _id: "$state", n: { $sum: 1 } } }]);
      for (const row of rows) counts[row._id] = row.n;
      failures = (await NotificationModel.find({ state: "FAILED" }).sort({ createdAt: -1 }).limit(10).lean()).map(doc => fromDoc(doc as unknown as Record<string, unknown>));
    } else {
      for (const job of memory) if (job.state in counts) counts[job.state as keyof typeof counts]++;
      failures = memory.filter(job => job.state === "FAILED").slice(-10).reverse();
    }
    return { pending: counts.PENDING + counts.SENDING, failed: counts.FAILED, failures: failures.map(job => ({ id: job.id, label: job.label, attempts: job.attempts, lastError: job.lastError, createdAt: new Date(job.createdAt).toISOString() })) };
  }

  /** Vuelve a intentar los avisos que agotaron sus intentos. */
  async retryFailed(): Promise<number> {
    const reset = { state: "PENDING" as const, attempts: 0, nextAttemptAt: new Date(), leaseUntil: null, lastError: "" };
    if (mongo()) return (await NotificationModel.updateMany({ state: "FAILED" }, { $set: reset })).modifiedCount;
    return unitOfWork(async () => { const failed = memory.filter(job => job.state === "FAILED"); failed.forEach(job => Object.assign(job, reset)); return failed.length; });
  }

  private track(work: Promise<void>) { this.inFlight.add(work); void work.finally(() => this.inFlight.delete(work)); }

  private async claim(now: Date): Promise<NotificationJob | null> {
    const lease = new Date(now.getTime() + LEASE_MS);
    if (mongo()) {
      const doc = await NotificationModel.findOneAndUpdate(
        { $or: [{ state: "PENDING", nextAttemptAt: { $lte: now } }, { state: "SENDING", leaseUntil: { $lt: now } }] },
        { $set: { state: "SENDING", leaseUntil: lease }, $inc: { attempts: 1 } },
        { sort: { nextAttemptAt: 1 }, new: true }).lean();
      return doc ? fromDoc(doc as unknown as Record<string, unknown>) : null;
    }
    // En memoria, reclamar y anotar pasan por la misma cola que las demás
    // operaciones, para que una reversión ajena no deshaga un envío anotado.
    return unitOfWork(async () => {
      const job = memory.filter(j => (j.state === "PENDING" && j.nextAttemptAt <= now) || (j.state === "SENDING" && j.leaseUntil! < now)).sort((a, b) => +a.nextAttemptAt - +b.nextAttemptAt)[0];
      if (!job) return null;
      Object.assign(job, { state: "SENDING", leaseUntil: lease, attempts: job.attempts + 1 });
      return { ...job };
    });
  }

  private async deliver(job: NotificationJob, order?: MailOrder): Promise<void> {
    const channel = channels[job.kind];
    let outcome: "SENT" | "SKIPPED" | "RETRY";
    let error = "";
    try {
      const data = order ?? (job.orderId ? await this.loadOrder(job.orderId) : undefined) ?? undefined;
      if (job.orderId && !data) { outcome = "SKIPPED"; error = "El pedido ya no existe"; }
      else if (await channel.send(job, data)) outcome = "SENT";
      else if (!channel.enabled()) { outcome = "SKIPPED"; error = "Canal sin configurar"; }
      else { outcome = "RETRY"; error = "El proveedor rechazó el envío o no respondió"; }
    } catch (failure) {
      outcome = "RETRY"; error = failure instanceof Error ? failure.message.slice(0, 300) : "Error desconocido";
    }
    try { await this.settle(job, outcome, error); }
    catch (failure) { console.error(`[avisos] no se pudo anotar ${job.label}`, failure); }
  }

  private async settle(job: NotificationJob, outcome: "SENT" | "SKIPPED" | "RETRY", error: string) {
    const now = new Date();
    const failed = outcome === "RETRY" && job.attempts >= MAX_ATTEMPTS;
    if (outcome === "RETRY" && !failed) console.warn(`[avisos] ${job.label}: intento ${job.attempts} falló; se reintenta`);
    if (failed) console.error(`[avisos] ${job.label}: agotó ${MAX_ATTEMPTS} intentos; revísalo en el panel`);
    const patch = outcome === "RETRY"
      ? { state: (failed ? "FAILED" : "PENDING") as State, nextAttemptAt: new Date(now.getTime() + (BACKOFF_MS[job.attempts - 1] ?? BACKOFF_MS.at(-1)!)), leaseUntil: null, lastError: error }
      : { state: outcome as State, sentAt: outcome === "SENT" ? now : null, leaseUntil: null, lastError: error };
    // Solo anota quien tiene la reserva vigente de este intento.
    if (mongo()) {
      await NotificationModel.updateOne({ _id: job.id, state: "SENDING", attempts: job.attempts }, { $set: { ...patch, ...(outcome === "RETRY" ? {} : { purgeAt: new Date(now.getTime() + KEEP_DONE_MS) }) } });
      return;
    }
    await unitOfWork(async () => {
      const current = memory.find(j => j.id === job.id);
      if (current && current.state === "SENDING" && current.attempts === job.attempts) Object.assign(current, patch);
    });
  }

  private async purge(now: Date) {
    if (mongo()) return; // Índice TTL en MongoDB.
    const limit = now.getTime() - KEEP_DONE_MS;
    if (memory.some(job => (job.state === "SENT" || job.state === "SKIPPED") && +job.createdAt < limit))
      await unitOfWork(async () => { memory = memory.filter(job => !((job.state === "SENT" || job.state === "SKIPPED") && +job.createdAt < limit)); });
  }
}

export const notificationOutbox = new NotificationOutbox();
