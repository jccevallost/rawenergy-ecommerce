// P05 sobre MongoDB real: avisos guardados en la transacción del pedido,
// recuperación tras caída, reintento y reclamación atómica entre despachadores.
// Uso (réplica temporal): node scripts/review-transactions-local.mjs scripts/review-outbox.mts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const uri = process.env.AUDIT_MONGODB_URI;
if (!uri || !/replicaSet=/.test(uri) || !/rawenergy_audit_/.test(uri)) throw new Error("AUDIT_MONGODB_URI debe apuntar a una base temporal rawenergy_audit_* con replicaSet.");
const { productService } = await import("../apps/api/src/services/product.service.ts");
const { orderService } = await import("../apps/api/src/services/order.service.ts");
const { supplyService } = await import("../apps/api/src/services/supply.service.ts");
const { mailService } = await import("../apps/api/src/services/mail.service.ts");
const { telegramService } = await import("../apps/api/src/services/telegram.service.ts");
const { notificationOutbox, NotificationModel, LEASE_MS } = await import("../apps/api/src/services/outbox.service.ts");
const { demoProducts } = await import("../apps/api/src/data/demoProducts.ts");
const { unitOfWork } = await import("../apps/api/src/lib/unitOfWork.ts");
const mongoose = (await import("mongoose")).default;

const sent: string[] = [];
let telegramFailures = 0;
mailService.sendOrderConfirmation = async order => { sent.push(`mail:${order.orderNumber}`); return true; };
mailService.sendOperatorAlert = async () => true;
telegramService.sendOrderAlert = async order => { if (telegramFailures > 0) { telegramFailures--; return false; } sent.push(`telegram:${order.orderNumber}`); return true; };
telegramService.sendNotice = async text => { sent.push(`notice:${text}`); return true; };
Object.defineProperty(telegramService, "enabled", { get: () => true });

const checks: string[] = [];
const later = (ms: number) => new Date(Date.now() + ms);
await productService.connect(uri);
try {
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  await supplyService.bootstrap();
  const base = demoProducts[1]!;
  const payload = { ...base, slug: `aviso-${randomUUID()}`, featured: false, variants: [{ ...base.variants[0]!, sku: randomUUID(), price: 30, stock: 5 }] };
  const product = await productService.upsert(undefined, payload) as { _id: unknown };
  const buy = () => orderService.create({ idempotencyKey: randomUUID(), customer: { fullName: "Persona de prueba", email: "avisos@example.test", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: "1700000001" }, items: [{ productId: String(product._id), variantSku: payload.variants[0]!.sku, quantity: 1 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" }) as Promise<{ _id: unknown; orderNumber: string }>;

  const order = await buy();
  await notificationOutbox.drain();
  const jobs = await NotificationModel.find({ orderId: String(order._id) }).lean();
  assert.equal(jobs.length, 3); assert(jobs.every(job => job.state === "SENT" && job.purgeAt));
  assert.deepEqual(sent.filter(item => item.endsWith(order.orderNumber)).sort(), [`mail:${order.orderNumber}`, `telegram:${order.orderNumber}`]);
  checks.push("Pedido: tres avisos guardados con el pedido, enviados tras el commit y marcados para borrarse a los 30 días");

  await assert.rejects(unitOfWork(async () => { await notificationOutbox.enqueue([{ kind: "OPERATOR_NOTICE", label: "revertido", text: "no debe salir" }]); throw new Error("fallo posterior"); }), /fallo posterior/);
  await notificationOutbox.drain();
  assert.equal(await NotificationModel.countDocuments({ label: "revertido" }), 0); assert(!sent.includes("notice:no debe salir"));
  checks.push("Transacción revertida: el aviso no queda guardado ni se envía");

  telegramFailures = 1;
  const retried = await buy();
  await notificationOutbox.drain();
  const pending = await NotificationModel.findOne({ orderId: String(retried._id), kind: "ORDER_TELEGRAM" }).lean();
  assert.equal(pending!.state, "PENDING"); assert(pending!.nextAttemptAt! > new Date());
  await notificationOutbox.run(later(61_000));
  assert.equal((await NotificationModel.findById(pending!._id).lean())!.state, "SENT");
  assert.equal(sent.filter(item => item === `telegram:${retried.orderNumber}`).length, 1);
  checks.push("Telegram falla una vez: queda pendiente con espera y el reintento lo envía una sola vez");

  // Caída entre el commit y el envío: el aviso quedó reservado por un proceso que ya no existe.
  const crashed = await buy();
  await notificationOutbox.drain();
  await NotificationModel.updateMany({ orderId: String(crashed._id) }, { $set: { state: "SENDING", leaseUntil: new Date(Date.now() - 1000), sentAt: null } });
  const before = sent.length;
  await notificationOutbox.run(later(1_000));
  assert.equal(await NotificationModel.countDocuments({ orderId: String(crashed._id), state: "SENT" }), 3);
  assert.equal(sent.length - before, 2);
  checks.push("Proceso caído con avisos reservados: al vencer la reserva se retoman y se envían");

  await NotificationModel.insertMany(Array.from({ length: 3 }, (_, i) => ({ _id: randomUUID(), kind: "OPERATOR_NOTICE", label: `concurrente ${i}`, text: `concurrente ${i}`, state: "PENDING", attempts: 0, nextAttemptAt: new Date(Date.now() - 1000), leaseUntil: null, lastError: "" })));
  const claimer = notificationOutbox as unknown as { claim: (now: Date) => Promise<{ id: string } | null> };
  const claims = (await Promise.all(Array.from({ length: 10 }, () => claimer.claim(new Date())))).filter(Boolean).map(job => job!.id);
  assert.equal(claims.length, 3); assert.equal(new Set(claims).size, 3);
  assert.equal(await NotificationModel.countDocuments({ label: /concurrente/, state: "SENDING", leaseUntil: { $gt: later(LEASE_MS - 60_000) } }), 3);
  checks.push("10 despachadores a la vez sobre 3 avisos: cada aviso reclamado una sola vez");

  const indexes = await NotificationModel.collection.indexes();
  assert(indexes.some(index => index.key.purgeAt === 1 && index.expireAfterSeconds === 0));
  checks.push("Índice TTL de limpieza activo");

  await mongoose.connection.db!.dropDatabase();
  console.log(JSON.stringify({ ok: true, checks }));
  if (process.env.AUDIT_REPORT_PATH) await writeFile(process.env.AUDIT_REPORT_PATH, JSON.stringify({ ok: true, mongo: (await mongoose.connection.db!.admin().serverInfo()).version, checks, limits: ["Réplica de un nodo", "Caída simulada marcando la reserva vencida; no se mató un proceso real", "Canales sustituidos: no envía correo ni Telegram reales"] }, null, 2));
} finally { await productService.disconnect(); }
