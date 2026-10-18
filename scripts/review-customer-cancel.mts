// CU11 sobre MongoDB real temporal: carreras de la cancelación del cliente con una sola transición y una sola
// liberación de stock. Uso: node scripts/review-transactions-local.mjs scripts/review-customer-cancel.mts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import { productService } from "../apps/api/src/services/product.service.js";
import { orderService } from "../apps/api/src/services/order.service.js";
import { supplyService } from "../apps/api/src/services/supply.service.js";
import { reservationService } from "../apps/api/src/services/reservation.service.js";
import { authService, type AuthUser } from "../apps/api/src/services/auth.service.js";
import { mailService } from "../apps/api/src/services/mail.service.js";
import { telegramService } from "../apps/api/src/services/telegram.service.js";
import { OrderModel } from "../apps/api/src/models/Order.js";
import { UserModel } from "../apps/api/src/models/User.js";
import { BlockedIdentityModel } from "../apps/api/src/models/BlockedIdentity.js";
import { demoProducts } from "../apps/api/src/data/demoProducts.js";

const uri = process.env.AUDIT_MONGODB_URI ?? "";
assert(/^mongodb:\/\/127\.0\.0\.1:\d+\/rawenergy_audit_[a-f0-9]+\?replicaSet=audit&directConnection=true$/.test(uri), "Solo se admite la DB aislada creada por el lanzador");
mailService.sendOrderConfirmation = async () => true; mailService.sendOperatorAlert = async () => true; mailService.sendStatusUpdate = async () => true; telegramService.sendOrderAlert = async () => true;
console.info = () => undefined;
const checks: string[] = [];
let serial = 950000;
const cedula = () => { const base = `17${String(++serial).padStart(7, "0")}`; const sum = base.split("").map(Number).reduce((s, v, i) => { let x = i % 2 === 0 ? v * 2 : v; if (x > 9) x -= 9; return s + x; }, 0); return base + ((10 - (sum % 10)) % 10); };
let sku = "", productId = "";
const stock = async () => (await productService.get(productId) as { variants: Array<{ sku: string; stock: number }> }).variants.find(v => v.sku === sku)!.stock;
const customer = async () => (await authService.createVerifiedCustomer({ name: "Cliente Mongo", email: `cancela-${randomUUID()}@example.test`, password: "Cancela-mongo-2026" })).user as AuthUser;
const buy = async (user: AuthUser, paymentMethod = "BANK_TRANSFER", shippingMethod = "SERVIENTREGA_NATIONAL") => orderService.create({ idempotencyKey: randomUUID(), customer: { fullName: "Cliente Mongo", email: user.email, phone: `09${String(++serial).padStart(8, "0")}`, province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: cedula() }, items: [{ productId, variantSku: sku, quantity: 1 }], shippingMethod, paymentMethod }, user) as Promise<{ _id: unknown; orderNumber: string }>;
const cancels = async (orderNumber: string) => ((await OrderModel.findOne({ orderNumber }).lean())!.history ?? []).filter(entry => entry.to === "CANCELLED").length;
const counter = async (user: AuthUser) => (await UserModel.findById(user.id).lean())!.customerCancellations ?? 0;

try {
  await productService.connect(uri);
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  await supplyService.bootstrap();
  const payload = structuredClone(demoProducts[1]!); payload.slug = `cancela-${randomUUID()}`; sku = randomUUID(); payload.variants = [{ ...payload.variants[0]!, sku, price: 20, stock: 100 }];
  productId = String((await productService.upsert(undefined, payload) as { id: string }).id);

  // 1. Dos cancelaciones simultáneas del mismo pedido: una transición, una liberación, contador +1.
  const a = await customer();
  const initial = await stock();
  const first = await buy(a);
  const both = await Promise.allSettled([orderService.cancelByCustomer(a, first.orderNumber), orderService.cancelByCustomer(a, first.orderNumber)]);
  assert(both.some(r => r.status === "fulfilled"));
  assert.equal(await stock(), initial); assert.equal(await cancels(first.orderNumber), 1); assert.equal(await counter(a), 1);
  checks.push("2 cancelaciones simultáneas: una transición, stock devuelto una vez y contador +1");

  // 2. Cancelar contra confirmar la contra entrega: un solo resultado coherente.
  const b = await customer();
  const cod = await buy(b, "CASH_ON_DELIVERY", "EXPRESS_QUITO_VALLES");
  const before = await stock();
  const race = await Promise.allSettled([orderService.cancelByCustomer(b, cod.orderNumber), orderService.confirmCashOnDelivery(String(cod._id), { location: "https://maps.example.test/1" })]);
  const after = (await OrderModel.findById(cod._id).lean())!;
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  if (after.status === "CANCELLED") { assert.equal(after.confirmedAt, null); assert.equal(await stock(), before + 1); }
  else { assert(after.confirmedAt); assert.equal(await stock(), before); assert.equal(await counter(b), 0); }
  checks.push(`Cancelar contra confirmar contra entrega: un ganador (${after.status === "CANCELLED" ? "cancelación" : "confirmación"}) y stock coherente`);

  // 3. Cancelar contra el vencimiento automático: una cancelación y una liberación.
  const c = await customer();
  const late = await buy(c);
  await OrderModel.updateOne({ _id: late._id }, { $set: { createdAt: new Date(Date.now() - 48 * 3600000) } });
  const stockBefore = await stock();
  await Promise.allSettled([orderService.cancelByCustomer(c, late.orderNumber), reservationService.expire(new Date(), 24)]);
  assert.equal(await cancels(late.orderNumber), 1); assert.equal(await stock(), stockBefore + 1);
  assert((await counter(c)) <= 1);
  checks.push("Cancelar contra vencimiento: una sola cancelación y una sola liberación");

  // 4. Comprobante registrado al mismo tiempo: o se cancela sin comprobante o se conserva con comprobante.
  const d = await customer();
  const proof = await buy(d);
  await Promise.allSettled([orderService.cancelByCustomer(d, proof.orderNumber), orderService.editDetails(String(proof._id), { paymentReference: "COMP-999" })]);
  const proofAfter = (await OrderModel.findById(proof._id).lean())!;
  assert(proofAfter.status === "CANCELLED" ? true : proofAfter.paymentReference === "COMP-999");
  checks.push(`Cancelar contra registrar comprobante: resultado coherente (${proofAfter.status === "CANCELLED" ? "cancelado" : "conserva comprobante"})`);

  // 5. Tercera cancelación: bloqueo, sesiones revocadas e identidades registradas en la misma transacción.
  const e = await customer();
  const three = [await buy(e), await buy(e), await buy(e)];
  for (const order of three) await orderService.cancelByCustomer(e, order.orderNumber);
  const blocked = (await UserModel.findById(e.id).lean())!;
  assert.equal(blocked.status, "BLOCKED"); assert.equal(blocked.blockedReason, "CANCELLATIONS"); assert.equal(blocked.sessions.length, 0);
  assert((await BlockedIdentityModel.countDocuments({ userId: e.id })) >= 4);
  checks.push("Tercera cancelación: cuenta BLOCKED, sesiones vacías e identidades registradas");

  await writeFile(process.env.AUDIT_REPORT_PATH!, JSON.stringify({ ok: true, database: mongoose.connection.name, checks }, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, checks }, null, 2) + "\n");
} finally {
  if (mongoose.connection.readyState === 1) { assert(mongoose.connection.name.startsWith("rawenergy_audit_")); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
}
