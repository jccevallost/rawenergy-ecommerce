import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import { ApolloServer } from "@apollo/server";
import { typeDefs } from "../apps/api/src/graphql/typeDefs.js";
import { resolvers } from "../apps/api/src/graphql/resolvers.js";
import { productService } from "../apps/api/src/services/product.service.js";
import { orderService } from "../apps/api/src/services/order.service.js";
import { auditService } from "../apps/api/src/services/audit.service.js";
import { mailService } from "../apps/api/src/services/mail.service.js";
import { telegramService } from "../apps/api/src/services/telegram.service.js";
import { OrderModel } from "../apps/api/src/models/Order.js";
import { ProductModel } from "../apps/api/src/models/Product.js";
import { demoProducts } from "../apps/api/src/data/demoProducts.js";
import { supplyService } from "../apps/api/src/services/supply.service.js";
import { reservationService } from "../apps/api/src/services/reservation.service.js";
const uri = process.env.AUDIT_MONGODB_URI ?? "";
assert(/^mongodb:\/\/127\.0\.0\.1:\d+\/rawenergy_audit_[a-f0-9]+\?replicaSet=audit&directConnection=true$/.test(uri), "Solo se admite la DB aislada creada por el lanzador");
const checks: string[] = [];
let notifications = 0;
mailService.sendOrderConfirmation = async () => { notifications++; return true; };
mailService.sendOperatorAlert = async () => true;
telegramService.sendOrderAlert = async () => true;
const server = new ApolloServer({ typeDefs, resolvers });
async function fixture(stock = 1) {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `mongo-${randomUUID()}`; payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), price: 25, stock }];
  const created = await productService.upsert(undefined, payload) as { id: string };
  const id = String(created.id);
  return { id, input: { idempotencyKey: randomUUID(), expectedTotal: 29, customer: { fullName: "Auditoría aislada", email: "audit@example.test", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Dirección ficticia 123", idNumber: "1700000001" }, items: [{ productId: id, variantSku: payload.variants[0]!.sku, quantity: 1 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" }, stock: async () => (await productService.get(id))!.variants[0]!.stock };
}
try {
  // Sin start(), el stop() de finally lanzaba un error que ocultaba el fallo real.
  await server.start();
  await productService.connect(uri);
  // Materialize collections and unique indexes before testing transaction races.
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  // Igual que server.ts al arrancar: sin la bodega principal no se puede reservar stock.
  await supplyService.bootstrap();
  const a = await fixture();
  const competition = await Promise.allSettled(Array.from({ length: 20 }, () => orderService.create({ ...a.input, idempotencyKey: randomUUID() })));
  assert.equal(competition.filter(result => result.status === "fulfilled").length, 1); assert.equal(await a.stock(), 0);
  assert.equal(await OrderModel.countDocuments({ "items.productId": a.id }), 1);
  checks.push("20 compras por última unidad: una orden, stock cero, sin sobreventa");
  const b = await fixture(); const sentBefore = notifications;
  const duplicates = await Promise.all(Array.from({ length: 20 }, () => orderService.create(b.input)));
  assert.equal(new Set(duplicates.map(order => String(order.id))).size, 1); assert.equal(await b.stock(), 0); assert.equal(notifications - sentBefore, 1);
  checks.push("20 reintentos concurrentes: una orden, una reserva, una notificación tras commit");
  const c = await fixture(2), d = await fixture(2);
  await ProductModel.updateOne({ _id: d.id }, { $set: { "variants.0.lots.0.expiresOn": "2000-01-01" } });
  await assert.rejects(orderService.create({ ...c.input, expectedTotal: 54, items: [...c.input.items, ...d.input.items] }), /vencido/);
  assert.equal(await c.stock(), 2); assert.equal(await d.stock(), 2); assert.equal(await OrderModel.countDocuments({ "items.productId": c.id }), 0);
  checks.push("Fallo de segunda reserva revierte primera reserva y pedido en MongoDB");
  const e = await fixture(2); const original = auditService.record.bind(auditService); const sent = notifications;
  auditService.record = async event => { if (event.action === "createCheckoutOrder" && event.status === "SUCCESS") throw new Error("fallo-auditoria-controlado"); return original(event); };
  try {
    const result = await server.executeOperation({ query: 'mutation($input:CheckoutInput!){createCheckoutOrder(input:$input){id}}', variables: { input: e.input } }, { contextValue: { user: null, requestId: randomUUID() } });
    assert(result.body.kind === "single" && result.body.singleResult.errors?.length);
    assert.equal(await e.stock(), 2); assert.equal(await OrderModel.countDocuments({ "items.productId": e.id }), 0); assert.equal(notifications, sent);
  } finally { auditService.record = original; }
  checks.push("Fallo de auditoría revierte pedido y stock; no se notifica rollback");
  const order = duplicates[0]!;
  await Promise.all([orderService.updateStatus(String(order.id), "CANCELLED"), orderService.updateStatus(String(order.id), "CANCELLED")]);
  assert.equal(await b.stock(), 1);
  checks.push("Cancelación concurrente repone una vez");
  await assert.rejects(orderService.create({ ...e.input, expectedTotal: 1 }), /total cambió/); assert.equal(await e.stock(), 2);
  checks.push("Total aceptado distinto rechazado sin reserva");
  // Reserva de 24 h (Claude, C17): vencimiento y pago simultáneos sobre MongoDB real.
  for (const round of [1, 2, 3]) {
    const f = await fixture(1);
    const pending = await orderService.create(f.input) as { id: unknown };
    const id = String(pending.id);
    await OrderModel.updateOne({ _id: id }, { $set: { createdAt: new Date(Date.now() - 25 * 3600000) } });
    const race = await Promise.allSettled([reservationService.expire(new Date(), 24), orderService.updateStatus(id, "PAID")]);
    const final = (await OrderModel.findById(id).lean())!.status;
    assert(["CANCELLED", "PAID"].includes(final), `Ronda ${round}: estado ${final}`);
    assert.equal(await f.stock(), final === "CANCELLED" ? 1 : 0, `Ronda ${round}: stock coherente con ${final}`);
    if (final === "CANCELLED") assert.equal(race[1].status, "rejected");
  }
  const g = await fixture(1);
  const review = await orderService.create(g.input) as { id: unknown };
  await orderService.updateStatus(String(review.id), "PAYMENT_REVIEW");
  await OrderModel.updateOne({ _id: String(review.id) }, { $set: { createdAt: new Date(Date.now() - 48 * 3600000) } });
  await reservationService.expire(new Date(), 24);
  assert.equal((await OrderModel.findById(String(review.id)).lean())!.status, "PAYMENT_REVIEW"); assert.equal(await g.stock(), 0);
  checks.push("Vencimiento de 24 h contra pago simultáneo: un solo ganador y stock coherente; pedido en revisión intacto");
  await writeFile(process.env.AUDIT_REPORT_PATH!, JSON.stringify({ ok: true, database: mongoose.connection.name, mongo: (await mongoose.connection.db!.admin().serverInfo()).version, checks, limits: ["Un replica set local de un nodo; no prueba caída de primario, particiones ni recuperación de desastres"] }, null, 2));
} finally {
  await server.stop();
  if (mongoose.connection.readyState === 1) { assert(mongoose.connection.name.startsWith("rawenergy_audit_")); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
}
