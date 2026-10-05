// C68: cambios de la etapa (C60–C70) sobre MongoDB real: índice de caducidad de la bitácora,
// pedidos pendientes por persona y número de pedido, segundo factor y campos retirados.
// Uso (réplica temporal): node scripts/review-transactions-local.mjs scripts/review-security-real.mts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

const uri = process.env.AUDIT_MONGODB_URI;
if (!uri || !/replicaSet=/.test(uri) || !/rawenergy_audit_/.test(uri)) throw new Error("AUDIT_MONGODB_URI debe apuntar a una base temporal rawenergy_audit_* con replicaSet.");
const { env } = await import("../apps/api/src/config/env.ts");
const { productService } = await import("../apps/api/src/services/product.service.ts");
const { orderService } = await import("../apps/api/src/services/order.service.ts");
const { supplyService } = await import("../apps/api/src/services/supply.service.ts");
const { auditService, AuditModel } = await import("../apps/api/src/services/audit.service.ts");
const { authService } = await import("../apps/api/src/services/auth.service.ts");
const { OrderModel } = await import("../apps/api/src/models/Order.ts");
const { ProductModel } = await import("../apps/api/src/models/Product.ts");
const { UserModel } = await import("../apps/api/src/models/User.ts");
const { totpCode, currentStep } = await import("../apps/api/src/lib/totp.ts");
const { demoProducts } = await import("../apps/api/src/data/demoProducts.ts");
const mongoose = (await import("mongoose")).default;

const checks: string[] = [];
await productService.connect(uri);
try {
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  authService.setPersistence(true);
  await authService.bootstrapAdmin();
  await supplyService.bootstrap();

  // 1. Bitácora con fecha de borrado e índice de caducidad (S15).
  const ttl = (await AuditModel.collection.indexes()).find(index => index.key.expiresAt === 1);
  assert.equal(ttl?.expireAfterSeconds, 0);
  const row = await auditService.record({ requestId: randomUUID(), actorId: "x", actorEmail: "", ip: "", action: "prueba", entity: "users", entityId: "", status: "SUCCESS" });
  const stored = await AuditModel.findOne({ action: "prueba" }).lean();
  const days = (stored!.expiresAt!.getTime() - Date.now()) / 86_400_000;
  assert.ok(days > env.AUDIT_RETENTION_DAYS - 1 && days <= env.AUDIT_RETENTION_DAYS, `expiresAt a ${days} días`);
  const old = new Date("2026-01-01T00:00:00Z");
  await AuditModel.collection.insertOne({ action: "anterior", createdAt: old });
  assert.ok((await auditService.applyRetention()) >= 1);
  const migrated = await AuditModel.findOne({ action: "anterior" }).lean();
  assert.equal(migrated!.expiresAt!.getTime(), old.getTime() + env.AUDIT_RETENTION_DAYS * 86_400_000);
  assert.equal(await auditService.applyRetention(), 0);
  checks.push(`Bitácora: índice TTL en expiresAt, evento nuevo a ${Math.round(days)} días, evento anterior completado una vez (row ${row.id.slice(0, 8)})`);

  // 2. Pedidos pendientes por persona y número de pedido (S04, S17).
  env.MAX_PENDING_ORDERS_PER_CUSTOMER = 2;
  const base = demoProducts[1]!;
  const product = await productService.upsert(undefined, { ...base, slug: `pendientes-${randomUUID()}`, variants: [{ ...base.variants[0]!, sku: randomUUID(), price: 30, stock: 50 }] }) as { _id: unknown; variants: Array<{ sku: string }> };
  const order = (customer: Record<string, string>) => orderService.create({ idempotencyKey: randomUUID(), customer: { fullName: "Persona de prueba", email: "pendientes@example.test", phone: "0999999911", province: "Pichincha", city: "Quito", address: "Av. Amazonas N34-100", idNumber: "1700000001", ...customer }, items: [{ productId: String(product._id), variantSku: product.variants[0]!.sku, quantity: 1 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" }) as Promise<{ _id: unknown; orderNumber: string }>;
  const first = await order({});
  await order({ email: "otra@example.test", phone: "0999999922" });
  await assert.rejects(order({ email: "tercera@example.test", phone: "0999999933" }), /pedidos pendientes/);
  await orderService.updateStatus(String(first._id), "CANCELLED");
  await order({ email: "tercera@example.test", phone: "0999999933" });
  assert.match(first.orderNumber, /^RE-\d{6}-[A-Z0-9]{6}$/);
  assert.ok((await OrderModel.collection.indexes()).some(index => index.key.orderNumber === 1 && index.unique));
  // Cinco pedidos simultáneos de otra persona con tope 2: se informa cuántos pasan (la regla es antiabuso, no exacta).
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => order({ idNumber: "1710034065", email: "rafaga@example.test", phone: "0999999944" })));
  const passed = results.filter(result => result.status === "fulfilled").length;
  checks.push(`Pendientes: tercero rechazado con el mismo documento, cupo liberado al cancelar, número RE-AAMMDD-XXXXXX con índice único; ráfaga de 5 simultáneos con tope 2: ${passed} registrados`);
  env.MAX_PENDING_ORDERS_PER_CUSTOMER = 20;

  // 3. Segundo factor guardado en la base (C69) y sesión de 12 h del personal.
  const admin = (await authService.users("ADMIN"))[0]!;
  const staff = await authService.saveAccount(admin, undefined, { name: "Bodega real", email: `bodega-${randomUUID().slice(0, 6)}@example.test`, password: "Clave-de-bodega-77", role: "WAREHOUSE", status: "ACTIVE" });
  const session = await authService.login({ email: staff.email, password: "Clave-de-bodega-77" });
  const actor = (await authService.me(session.token))!;
  const sessionDoc = await UserModel.findById(staff.id).lean();
  const hours = (new Date(sessionDoc!.sessions!.at(-1)!.expiresAt!).getTime() - Date.now()) / 3_600_000;
  assert.ok(hours > 11.9 && hours <= 12);
  const { secret } = await authService.startTwoFactor(actor);
  const step = currentStep();
  const { recoveryCodes } = await authService.confirmTwoFactor(actor, totpCode(secret, step));
  const userDoc = await UserModel.findById(staff.id).lean();
  assert.equal(userDoc!.totpEnabled, true);
  assert.ok(userDoc!.totpSecret && !userDoc!.totpSecret.includes(secret));
  assert.equal(userDoc!.totpRecovery!.length, 8);
  await assert.rejects(authService.login({ email: staff.email, password: "Clave-de-bodega-77" }), /código de 6 dígitos/);
  await assert.rejects(authService.login({ email: staff.email, password: "Clave-de-bodega-77", code: totpCode(secret, step) }), /ya usado/);
  await authService.login({ email: staff.email, password: "Clave-de-bodega-77", code: recoveryCodes[0] });
  assert.equal((await UserModel.findById(staff.id).lean())!.totpRecovery!.length, 7);
  await assert.rejects(authService.login({ email: staff.email, password: "Clave-de-bodega-77", code: recoveryCodes[0] }), /ya usado/);
  checks.push(`Segundo factor: secreto cifrado en la base, 8 códigos de recuperación (hash), código reutilizado rechazado, recuperación consumida y guardada (quedan 7); sesión del personal de ${hours.toFixed(1)} h`);

  // 4. Campos retirados (C67): un panel anterior que los envía no los guarda.
  const legacy = await productService.upsert(undefined, { ...base, slug: `anterior-${randomUUID()}`, vitalCoinsReward: 5, maxInstallments: 3, hasFreeShipping: true, storeBadges: ["Gratis en ordenes seleccionadas"], variants: [{ ...base.variants[0]!, sku: randomUUID() }] } as never) as { _id: unknown };
  const raw = await ProductModel.collection.findOne({ _id: legacy._id as never });
  for (const key of ["vitalCoinsReward", "maxInstallments", "hasFreeShipping", "storeBadges"]) assert.ok(!(key in raw!), `${key} guardado`);
  checks.push("Campos retirados: un producto enviado con puntos, cuotas, envío gratis por producto y mensajes comerciales se guarda sin ellos");

  await writeFile("docs/auditoria-fase-c-evidencia/c68/review-security-real.json", JSON.stringify({ ok: true, mongo: (await mongoose.connection.db!.admin().serverInfo()).version, checks }, null, 2));
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  await productService.disconnect();
}
