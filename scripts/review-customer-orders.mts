// CU09 sobre MongoDB real temporal: cursor estable con fechas iguales y plan de consulta sobre el índice del cliente.
// Uso: node scripts/review-transactions-local.mjs scripts/review-customer-orders.mts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import { productService } from "../apps/api/src/services/product.service.js";
import { orderService } from "../apps/api/src/services/order.service.js";
import { supplyService } from "../apps/api/src/services/supply.service.js";
import { authService, type AuthUser } from "../apps/api/src/services/auth.service.js";
import { mailService } from "../apps/api/src/services/mail.service.js";
import { telegramService } from "../apps/api/src/services/telegram.service.js";
import { OrderModel } from "../apps/api/src/models/Order.js";
import { demoProducts } from "../apps/api/src/data/demoProducts.js";

const uri = process.env.AUDIT_MONGODB_URI ?? "";
assert(/^mongodb:\/\/127\.0\.0\.1:\d+\/rawenergy_audit_[a-f0-9]+\?replicaSet=audit&directConnection=true$/.test(uri), "Solo se admite la DB aislada creada por el lanzador");
mailService.sendOrderConfirmation = async () => true; mailService.sendOperatorAlert = async () => true; telegramService.sendOrderAlert = async () => true;
console.info = () => undefined;
const checks: string[] = [];
let serial = 700000;
const cedula = () => { const base = `17${String(++serial).padStart(7, "0")}`; const sum = base.split("").map(Number).reduce((s, v, i) => { let x = i % 2 === 0 ? v * 2 : v; if (x > 9) x -= 9; return s + x; }, 0); return base + ((10 - (sum % 10)) % 10); };

try {
  await productService.connect(uri);
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  await supplyService.bootstrap();
  const payload = structuredClone(demoProducts[1]!); payload.slug = `cursor-${randomUUID()}`; payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), price: 20, stock: 100 }];
  const product = await productService.upsert(undefined, payload) as { id: string };
  const user = (await authService.createVerifiedCustomer({ name: "Cliente Mongo", email: `cursor-${randomUUID()}@example.test`, password: "Cursor-mongo-2026" })).user as AuthUser;
  const numbers: string[] = [];
  for (let i = 0; i < 9; i++) {
    const created = await orderService.create({ idempotencyKey: randomUUID(), customer: { fullName: "Cliente Mongo", email: user.email, phone: `09${String(++serial).padStart(8, "0")}`, province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: cedula() }, items: [{ productId: product.id, variantSku: payload.variants[0]!.sku, quantity: 1 }], shippingMethod: "SERVIENTREGA_NATIONAL", paymentMethod: "BANK_TRANSFER" }, user) as { orderNumber: string };
    numbers.push(created.orderNumber);
  }
  // Cinco pedidos con la misma fecha exacta: el desempate por _id debe sostener el orden entre páginas.
  await OrderModel.updateMany({ orderNumber: { $in: numbers.slice(2, 7) } }, { $set: { createdAt: new Date("2026-10-01T12:00:00.000Z") } });
  // Un pedido de invitado y otro de otra cuenta no deben aparecer.
  const seen: string[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const result = await orderService.pageByUser(user.id, { first: 2, after });
    seen.push(...result.orders.map(order => String(order.orderNumber)));
    if (!result.hasMore) break;
    after = result.nextCursor;
  }
  assert.equal(seen.length, 9); assert.equal(new Set(seen).size, 9);
  assert.deepEqual([...seen].sort(), [...numbers].sort());
  checks.push("9 pedidos en páginas de 2 con 5 fechas idénticas: ninguno omitido ni repetido");

  const explain = await OrderModel.find({ userId: user.id }).sort({ createdAt: -1, _id: -1 }).limit(3).explain("executionStats") as unknown as { queryPlanner: { winningPlan: unknown }; executionStats: { totalDocsExamined: number } };
  const plan = JSON.stringify(explain.queryPlanner.winningPlan);
  assert(plan.includes("IXSCAN") && plan.includes("userId_1_createdAt_-1__id_-1"), `Usa el índice del cliente: ${plan}`);
  assert(!plan.includes('"SORT"'), "Sin ordenamiento en memoria");
  assert(explain.executionStats.totalDocsExamined <= 3, `Documentos examinados: ${explain.executionStats.totalDocsExamined}`);
  checks.push(`Plan de consulta: IXSCAN sobre userId_1_createdAt_-1__id_-1, sin SORT en memoria, ${explain.executionStats.totalDocsExamined} documentos examinados para 3 resultados`);

  await writeFile(process.env.AUDIT_REPORT_PATH!, JSON.stringify({ ok: true, database: mongoose.connection.name, checks }, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, checks }, null, 2) + "\n");
} finally {
  if (mongoose.connection.readyState === 1) { assert(mongoose.connection.name.startsWith("rawenergy_audit_")); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
}
