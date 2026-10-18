// CU12 sobre MongoDB real temporal: solicitudes de cancelación simultáneas y decisiones concurrentes.
// Uso: node scripts/review-transactions-local.mjs scripts/review-cancellation-requests.mts
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
import { CancellationRequestModel } from "../apps/api/src/models/CancellationRequest.js";
import { cancellationRequestService } from "../apps/api/src/services/cancellationRequest.service.js";
import { demoProducts } from "../apps/api/src/data/demoProducts.js";

const uri = process.env.AUDIT_MONGODB_URI ?? "";
assert(/^mongodb:\/\/127\.0\.0\.1:\d+\/rawenergy_audit_[a-f0-9]+\?replicaSet=audit&directConnection=true$/.test(uri), "Solo se admite la DB aislada creada por el lanzador");
mailService.sendOrderConfirmation = async () => true; mailService.sendOperatorAlert = async () => true; mailService.sendStatusUpdate = async () => true; telegramService.sendOrderAlert = async () => true;
console.info = () => undefined;
const checks: string[] = [];
let serial = 990000;
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

  const staff = { id: "staff-mongo", name: "Bodega", email: "bodega@example.test", role: "WAREHOUSE", status: "ACTIVE" } as AuthUser;

  // 1. Diez solicitudes simultáneas del mismo pedido: una sola pendiente (índice único parcial).
  const a = await customer();
  const paid = await buy(a);
  await orderService.updateStatus(String(paid._id), "PAID");
  await Promise.allSettled(Array.from({ length: 10 }, () => cancellationRequestService.request(a, paid.orderNumber, { reason: "OTHER" })));
  assert.equal(await CancellationRequestModel.countDocuments({ orderNumber: paid.orderNumber, status: "PENDING" }), 1);
  checks.push("10 solicitudes simultáneas del mismo pedido: una sola pendiente");

  // 2. Aprobar y rechazar a la vez: una decisión; si gana aprobar, una cancelación y una liberación.
  const request = (await CancellationRequestModel.findOne({ orderNumber: paid.orderNumber }).lean())!;
  const before = await stock();
  const decisions = await Promise.allSettled([
    cancellationRequestService.resolve(staff, String(request._id), { revision: request.revision, approve: true, publicNote: "" }),
    cancellationRequestService.resolve(staff, String(request._id), { revision: request.revision, approve: false, publicNote: "No es posible cancelar." })
  ]);
  assert.equal(decisions.filter(d => d.status === "fulfilled").length, 1);
  const decided = (await CancellationRequestModel.findById(request._id).lean())!;
  const order = (await OrderModel.findById(paid._id).lean())!;
  if (decided.status === "APPROVED") { assert.equal(order.status, "CANCELLED"); assert.equal(await stock(), before + 1); assert.equal(await cancels(paid.orderNumber), 1); }
  else { assert.equal(order.status, "PAID"); assert.equal(await stock(), before); }
  checks.push(`Aprobar contra rechazar a la vez: una decisión (${decided.status === "APPROVED" ? "aprobada, una cancelación y una liberación" : "rechazada, pedido intacto"})`);

  // 3. Si la cancelación falla al aprobar, la solicitud sigue pendiente (rollback conjunto).
  const b = await customer();
  const shipped = await buy(b);
  await orderService.updateStatus(String(shipped._id), "PAID");
  await cancellationRequestService.request(b, shipped.orderNumber, { reason: "DELAY" });
  await OrderModel.updateOne({ _id: shipped._id }, { $set: { status: "SHIPPED" } });
  const pendingShipped = (await CancellationRequestModel.findOne({ orderNumber: shipped.orderNumber }).lean())!;
  await assert.rejects(cancellationRequestService.resolve(staff, String(pendingShipped._id), { revision: pendingShipped.revision, approve: true, publicNote: "" }));
  assert.equal((await CancellationRequestModel.findById(pendingShipped._id).lean())!.status, "PENDING");
  checks.push("Aprobar un pedido ya despachado se rechaza y la solicitud sigue pendiente");

  await writeFile(process.env.AUDIT_REPORT_PATH!, JSON.stringify({ ok: true, database: mongoose.connection.name, checks }, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, checks }, null, 2) + "\n");
} finally {
  if (mongoose.connection.readyState === 1) { assert(mongoose.connection.name.startsWith("rawenergy_audit_")); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
}
