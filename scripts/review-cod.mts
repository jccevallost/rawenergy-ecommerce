// C36 sobre MongoDB real: contra entrega sin confirmar se cancela al vencer y
// repone stock; confirmar y vencer a la vez deja un solo resultado coherente.
// Uso (réplica temporal): node scripts/review-transactions-local.mjs scripts/review-cod.mts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const uri = process.env.AUDIT_MONGODB_URI;
if (!uri || !/replicaSet=/.test(uri) || !/rawenergy_audit_/.test(uri)) throw new Error("AUDIT_MONGODB_URI debe apuntar a una base temporal rawenergy_audit_* con replicaSet.");
const { productService } = await import("../apps/api/src/services/product.service.ts");
const { orderService } = await import("../apps/api/src/services/order.service.ts");
const { reservationService } = await import("../apps/api/src/services/reservation.service.ts");
const { supplyService } = await import("../apps/api/src/services/supply.service.ts");
const { demoProducts } = await import("../apps/api/src/data/demoProducts.ts");
const mongoose = (await import("mongoose")).default;

const checks: string[] = [];
const later = (hours: number) => new Date(Date.now() + hours * 3600000);
await productService.connect(uri);
try {
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  await supplyService.bootstrap();
  const base = demoProducts[1]!;
  const payload = { ...base, slug: `cod-${randomUUID()}`, featured: false, variants: [{ ...base.variants[0]!, sku: randomUUID(), price: 30, stock: 20 }] };
  const product = await productService.upsert(undefined, payload) as { _id: unknown };
  const stock = async () => ((await productService.get(String(product._id))) as { variants: Array<{ stock: number }> }).variants[0]!.stock;
  const buy = () => orderService.create({ idempotencyKey: randomUUID(), customer: { fullName: "Persona de prueba", email: "cod@example.test", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: "1700000001" }, items: [{ productId: String(product._id), variantSku: payload.variants[0]!.sku, quantity: 1 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "CASH_ON_DELIVERY" }) as Promise<{ _id: unknown }>;
  const state = async (id: unknown) => orderService.get(String(id)) as Promise<{ status: string; confirmedAt: Date | null; allowedNextStatuses?: string[] }>;

  const late = await buy();
  await assert.rejects(orderService.updateStatus(String(late._id), "PREPARING"), /no permitido/);
  await reservationService.expire(later(3.9), 24);
  assert.equal((await state(late._id)).status, "PENDING_PAYMENT");
  const before = await stock();
  await reservationService.expire(later(4.1), 24);
  assert.equal((await state(late._id)).status, "CANCELLED"); assert.equal(await stock(), before + 1);
  checks.push("Sin confirmar: no se prepara; a las 3,9 h sigue, a las 4,1 h se cancela y repone 1 unidad");

  let confirmedWins = 0, cancelWins = 0;
  for (let round = 0; round < 5; round++) {
    const order = await buy();
    const stockBefore = await stock();
    await Promise.allSettled([orderService.confirmCashOnDelivery(String(order._id), {}), reservationService.expire(later(4.1), 24)]);
    const final = await state(order._id);
    if (final.status === "CANCELLED") { assert.equal(final.confirmedAt ?? null, null); assert.equal(await stock(), stockBefore + 1); cancelWins++; }
    else { assert.equal(final.status, "PENDING_PAYMENT"); assert(final.confirmedAt); assert.equal(await stock(), stockBefore); confirmedWins++; }
  }
  checks.push(`Confirmar y vencer a la vez (5 rondas): un solo resultado coherente cada vez (confirmados ${confirmedWins}, cancelados ${cancelWins})`);

  const kept = await buy();
  await orderService.confirmCashOnDelivery(String(kept._id), { location: "https://maps.google.com/?q=-0.18,-78.48" });
  await reservationService.expire(later(30), 24);
  assert.equal((await state(kept._id)).status, "PENDING_PAYMENT");
  await orderService.updateStatus(String(kept._id), "PREPARING");
  checks.push("Confirmado con ubicación: no vence y pasa a «Preparando»");

  await mongoose.connection.db!.dropDatabase();
  console.log(JSON.stringify({ ok: true, checks }));
  if (process.env.AUDIT_REPORT_PATH) await writeFile(process.env.AUDIT_REPORT_PATH, JSON.stringify({ ok: true, mongo: (await mongoose.connection.db!.admin().serverInfo()).version, checks, limits: ["Réplica de un nodo", "Una sola instancia de API"] }, null, 2));
} finally { await productService.disconnect(); }
