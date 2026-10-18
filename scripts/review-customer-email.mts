// CU04 sobre MongoDB real temporal: altas y cambios de correo simultáneos contra el índice único.
// Uso: node scripts/review-transactions-local.mjs scripts/review-customer-email.mts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import { env } from "../apps/api/src/config/env.js";
import { productService } from "../apps/api/src/services/product.service.js";
import { authService } from "../apps/api/src/services/auth.service.js";
import { mailService } from "../apps/api/src/services/mail.service.js";
import { UserModel } from "../apps/api/src/models/User.js";

const uri = process.env.AUDIT_MONGODB_URI ?? "";
assert(/^mongodb:\/\/127\.0\.0\.1:\d+\/rawenergy_audit_[a-f0-9]+\?replicaSet=audit&directConnection=true$/.test(uri), "Solo se admite la DB aislada creada por el lanzador");
Object.assign(env, { MAIL_MODE: "simulated", STORE_URL: "https://tienda.example.test", CUSTOMER_ACCOUNTS: "on" });
console.info = () => undefined;
const checks: string[] = [];
const PASSWORD = "Cuenta-mongo-2026";
const linkOf = (to: string, key: string) => mailService.simulatedMailbox(to).map(m => decodeURIComponent(new RegExp(`#${key}=([^"&]+)`).exec(m.html)?.[1] ?? "")).filter(Boolean);
const verified = async (email: string) => {
  await authService.register({ name: "Cliente Mongo", email, password: PASSWORD }); await authService.flushBackground();
  await authService.verifyEmail(linkOf(email, "verificar")[0]!);
  return (await authService.login({ email, password: PASSWORD }));
};

try {
  await productService.connect(uri);
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));

  // 1. Diez altas simultáneas del mismo correo: una cuenta; todas reciben la misma respuesta.
  const same = `alta-${randomUUID().slice(0, 8)}@example.test`;
  const replies = await Promise.all(Array.from({ length: 10 }, () => authService.register({ name: "Cliente Mongo", email: same, password: PASSWORD })));
  await authService.flushBackground();
  assert.equal(new Set(replies.map(r => JSON.stringify(r))).size, 1);
  assert.equal(await UserModel.countDocuments({ email: same }), 1);
  checks.push("10 altas simultáneas del mismo correo: una cuenta y respuestas idénticas");

  // 2. Enlace de confirmación usado dos veces a la vez: una sola confirmación.
  const twice = `doble-${randomUUID().slice(0, 8)}@example.test`;
  await authService.register({ name: "Cliente Mongo", email: twice, password: PASSWORD }); await authService.flushBackground();
  const token = linkOf(twice, "verificar")[0]!;
  const uses = await Promise.allSettled([authService.verifyEmail(token), authService.verifyEmail(token)]);
  assert.equal(uses.filter(r => r.status === "fulfilled").length, 1);
  checks.push("Mismo enlace de confirmación usado dos veces a la vez: una sola confirmación");

  // 3. Dos cuentas confirman a la vez el cambio al mismo correo libre: el índice único decide.
  const a = await verified(`a-${randomUUID().slice(0, 8)}@example.test`), b = await verified(`b-${randomUUID().slice(0, 8)}@example.test`);
  const target = `disputa-${randomUUID().slice(0, 8)}@example.test`;
  await authService.requestEmailChange(a.user, target, PASSWORD); await authService.requestEmailChange(b.user, target, PASSWORD);
  await authService.flushBackground();
  const links = linkOf(target, "cambio-correo");
  assert.equal(links.length, 2);
  const confirmations = await Promise.allSettled(links.map(link => authService.confirmEmailChange(link)));
  assert.equal(confirmations.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(await UserModel.countDocuments({ email: target }), 1);
  const loser = await UserModel.findOne({ _id: { $in: [a.user.id, b.user.id] }, email: { $ne: target } }).lean();
  assert.ok(loser && !loser.pendingEmail && !loser.emailChangeHash);
  checks.push("2 cambios simultáneos al mismo correo: una cuenta lo obtiene; la otra conserva el suyo sin cambio pendiente");

  // 4. El cambio confirmado revoca la sesión anterior.
  const winner = await UserModel.findOne({ email: target }).lean();
  const previousToken = winner!._id.toString() === a.user.id ? a.token : b.token;
  assert.equal(await authService.me(previousToken), null);
  checks.push("Sesión anterior revocada tras confirmar el cambio de correo");

  await writeFile(process.env.AUDIT_REPORT_PATH!, JSON.stringify({ ok: true, database: mongoose.connection.name, checks }, null, 2));
  process.stdout.write(JSON.stringify({ ok: true, checks }, null, 2) + "\n");
} finally {
  if (mongoose.connection.readyState === 1) { assert(mongoose.connection.name.startsWith("rawenergy_audit_")); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
}
