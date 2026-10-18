// CU14 sobre MongoDB real temporal: reversión por bandera. Con CUSTOMER_ACCOUNTS=off la tienda vuelve a modo
// invitado sin borrar usuarios, perfiles, pedidos ni solicitudes, y el personal sigue resolviendo solicitudes.
// Al volver a «on» todo sigue ahí. Uso: node scripts/review-transactions-local.mjs scripts/review-accounts-rollback.mts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import { env } from "../apps/api/src/config/env.js";
import { productService } from "../apps/api/src/services/product.service.js";
import { orderService } from "../apps/api/src/services/order.service.js";
import { supplyService } from "../apps/api/src/services/supply.service.js";
import { authService, type AuthUser } from "../apps/api/src/services/auth.service.js";
import { customerProfileService } from "../apps/api/src/services/customerProfile.service.js";
import { cancellationRequestService } from "../apps/api/src/services/cancellationRequest.service.js";
import { mailService } from "../apps/api/src/services/mail.service.js";
import { telegramService } from "../apps/api/src/services/telegram.service.js";
import { OrderModel } from "../apps/api/src/models/Order.js";
import { UserModel } from "../apps/api/src/models/User.js";
import { CustomerProfileModel } from "../apps/api/src/models/CustomerProfile.js";
import { CancellationRequestModel } from "../apps/api/src/models/CancellationRequest.js";
import { demoProducts } from "../apps/api/src/data/demoProducts.js";

const uri = process.env.AUDIT_MONGODB_URI ?? "";
assert(/^mongodb:\/\/127\.0\.0\.1:\d+\/rawenergy_audit_[a-f0-9]+\?replicaSet=audit&directConnection=true$/.test(uri), "Solo se admite la DB aislada creada por el lanzador");
mailService.sendOrderConfirmation = async () => true; mailService.sendOperatorAlert = async () => true; mailService.sendStatusUpdate = async () => true; telegramService.sendOrderAlert = async () => true;
console.info = () => undefined;
const checks: string[] = [];
const PASSWORD = "Reversion-mongo-2026";
const counts = async () => ({ users: await UserModel.countDocuments(), profiles: await CustomerProfileModel.countDocuments(), orders: await OrderModel.countDocuments(), requests: await CancellationRequestModel.countDocuments() });

try {
  await productService.connect(uri);
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  await supplyService.bootstrap();
  await authService.bootstrapAdmin();
  const admin = (await authService.users("ADMIN"))[0]!;
  const sku = randomUUID();
  const payload = structuredClone(demoProducts[1]!); payload.slug = `reversion-${randomUUID()}`; payload.variants = [{ ...payload.variants[0]!, sku, price: 20, stock: 50 }];
  const productId = String((await productService.upsert(undefined, payload) as { id: string }).id);
  const identity = { fullName: "Cliente Piloto", email: `piloto-${randomUUID()}@example.test`, phone: "0991239876", province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: "0926687856" };
  const buy = (user: AuthUser | null, extra: Record<string, unknown> = {}) => orderService.create({ idempotencyKey: randomUUID(), customer: { ...identity, email: user?.email ?? identity.email }, items: [{ productId, variantSku: sku, quantity: 1 }], shippingMethod: "SERVIENTREGA_NATIONAL", paymentMethod: "BANK_TRANSFER", ...extra }, user) as Promise<{ _id: unknown; orderNumber: string }>;

  // Piloto con cuentas: perfil, dirección, pedido con dirección guardada y solicitud pendiente.
  env.CUSTOMER_ACCOUNTS = "on";
  const { user, token } = await authService.createVerifiedCustomer({ name: "Cliente Piloto", email: identity.email, password: PASSWORD }) as { user: AuthUser; token: string };
  const { addressId, profile } = await customerProfileService.addAddress(user, { label: "Casa", province: "Pichincha", city: "Quito", address: "Av. Amazonas N24-100 y Colón" }, 0);
  const withAddress = await buy(user, { delivery: { addressId, addressUpdatedAt: profile.addresses[0]!.updatedAt } });
  const paid = await buy(user);
  await orderService.updateStatus(String(paid._id), "PAID");
  await cancellationRequestService.request(user, paid.orderNumber, { reason: "OTHER" });
  const before = await counts();

  // Reversión: modo invitado.
  env.CUSTOMER_ACCOUNTS = "off";
  assert.equal(await authService.me(token), null, "La sesión del cliente deja de valer");
  await assert.rejects(authService.login({ email: identity.email, password: PASSWORD }), /ya no usa cuentas/);
  await assert.rejects(authService.register({ name: "Nueva", email: `nueva-${randomUUID()}@example.test`, password: PASSWORD }), /ya no usa cuentas/);
  const guest = await buy(null);
  assert.equal((await OrderModel.findById(guest._id).lean())!.userId, null);
  assert.deepEqual(await counts(), { ...before, orders: before.orders + 1 }, "Nada se borró");
  checks.push("Modo invitado: sesión y acceso de clientes sin efecto, alta cerrada, compra como invitado operativa; usuarios, perfiles, pedidos y solicitudes intactos");

  // El personal resuelve la solicitud pendiente aunque no haya cuentas públicas.
  const pending = (await cancellationRequestService.list("PENDING")).find(request => request.orderNumber === paid.orderNumber)!;
  await cancellationRequestService.resolve(admin, pending.id, { revision: pending.revision, approve: true, publicNote: "" });
  assert.equal((await OrderModel.findById(paid._id).lean())!.status, "CANCELLED");
  checks.push("Con cuentas apagadas el personal aprueba una solicitud pendiente y el pedido se cancela");

  // Vuelta a «on»: la cuenta, su perfil y su historial siguen ahí.
  env.CUSTOMER_ACCOUNTS = "on";
  const back = await authService.login({ email: identity.email, password: PASSWORD });
  const page = await orderService.pageByUser(back.user.id, {});
  assert.equal(page.orders.length, 2);
  assert.equal((await customerProfileService.get(back.user)).addresses.length, 1);
  assert.equal((await OrderModel.findById(withAddress._id).lean())!.delivery?.addressLabel, "Casa");
  checks.push("De vuelta a «on»: acceso, perfil con su dirección e historial de 2 pedidos sin pérdida");

  await writeFile(process.env.AUDIT_REPORT_PATH!, JSON.stringify({ ok: true, database: mongoose.connection.name, checks }, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, checks }, null, 2) + "\n");
} finally {
  if (mongoose.connection.readyState === 1) { assert(mongoose.connection.name.startsWith("rawenergy_audit_")); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
}
