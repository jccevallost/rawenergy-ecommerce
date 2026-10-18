// CU03 sobre MongoDB real temporal: concurrencia, reversión y coherencia del perfil del cliente.
// Uso: node scripts/review-transactions-local.mjs scripts/review-customer-profile.mts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import { productService } from "../apps/api/src/services/product.service.js";
import { authService, type AuthUser } from "../apps/api/src/services/auth.service.js";
import { customerProfileService } from "../apps/api/src/services/customerProfile.service.js";
import { CustomerProfileModel } from "../apps/api/src/models/CustomerProfile.js";
import { UserModel } from "../apps/api/src/models/User.js";

const uri = process.env.AUDIT_MONGODB_URI ?? "";
assert(/^mongodb:\/\/127\.0\.0\.1:\d+\/rawenergy_audit_[a-f0-9]+\?replicaSet=audit&directConnection=true$/.test(uri), "Solo se admite la DB aislada creada por el lanzador");
const checks: string[] = [];
const home = { label: "Casa", province: "Pichincha", city: "Quito", address: "Av. Amazonas N24-100 y Colón", reference: "" };
const customer = async () => (await authService.createVerifiedCustomer({ name: "Cliente Mongo", email: `mongo-${randomUUID()}@example.test`, password: "Perfil-mongo-123!" })).user as AuthUser;
const code = (result: PromiseSettledResult<unknown>) => result.status === "rejected" ? (result.reason as { extensions?: { code?: string } }).extensions?.code : "OK";

try {
  await productService.connect(uri);
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));

  // 1. Creación concurrente del perfil: el _id = userId impide dos documentos.
  const a = await customer();
  const created = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => customerProfileService.updateContact(a, { name: "Cliente Mongo", phone: `09912345${String(i).padStart(2, "0")}` }, 0)));
  assert.equal(created.filter(r => r.status === "fulfilled").length, 1);
  assert.ok(created.filter(r => r.status === "rejected").every(r => code(r) === "CONFLICT"));
  assert.equal(await CustomerProfileModel.countDocuments({ _id: a.id }), 1);
  checks.push("10 creaciones simultáneas del perfil: un documento, 9 conflictos");

  // 2. Altas simultáneas con la misma revisión: una gana; el resto conflicto; ninguna dirección perdida o duplicada.
  const b = await customer();
  const adds = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => customerProfileService.addAddress(b, { ...home, address: `Calle concurrente ${i + 1} y Principal` }, 0)));
  assert.equal(adds.filter(r => r.status === "fulfilled").length, 1);
  const bProfile = await CustomerProfileModel.findById(b.id).lean();
  assert.equal(bProfile!.addresses.length, 1); assert.equal(bProfile!.revision, 1);
  assert.equal(bProfile!.defaultAddressId, bProfile!.addresses[0]!.id);
  checks.push("8 altas simultáneas con la misma revisión: una dirección, predeterminada coherente, 7 conflictos");

  // 3. Doble clic de la misma dirección: el reintento devuelve la existente.
  const winner = bProfile!.addresses[0]!;
  const retry = await customerProfileService.addAddress(b, { ...home, address: `  ${winner.address.toUpperCase()} ` }, 0);
  assert.equal(retry.duplicate, true); assert.equal(retry.addressId, winner.id);
  assert.equal((await CustomerProfileModel.findById(b.id).lean())!.addresses.length, 1);
  checks.push("Reintento de la misma dirección con revisión vieja: se reutiliza, sin duplicado");

  // 4. Dos cambios simultáneos de predeterminada: uno gana y la predeterminada pertenece a la libreta.
  const c = await customer();
  let rev = 0; const ids: string[] = [];
  for (let i = 0; i < 3; i++) { const r = await customerProfileService.addAddress(c, { ...home, address: `Calle predeterminada ${i + 1} y Principal` }, rev); ids.push(r.addressId); rev = r.profile.revision; }
  const defaults = await Promise.allSettled([customerProfileService.setDefaultAddress(c, ids[1], rev), customerProfileService.setDefaultAddress(c, ids[2], rev)]);
  assert.equal(defaults.filter(r => r.status === "fulfilled").length, 1);
  const cProfile = await CustomerProfileModel.findById(c.id).lean();
  assert.ok(cProfile!.addresses.some(x => x.id === cProfile!.defaultAddressId));
  checks.push("2 cambios simultáneos de predeterminada: uno gana y la predeterminada existe en la libreta");

  // 5. Borrar la predeterminada contra marcarla: nunca queda una predeterminada huérfana.
  const race = await Promise.allSettled([customerProfileService.removeAddress(c, cProfile!.defaultAddressId, cProfile!.revision, null), customerProfileService.setDefaultAddress(c, ids[0], cProfile!.revision)]);
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  const after = await CustomerProfileModel.findById(c.id).lean();
  assert.ok(after!.defaultAddressId === null || after!.addresses.some(x => x.id === after!.defaultAddressId));
  checks.push("Borrar la predeterminada contra elegir otra: sin predeterminada huérfana");

  // 6. Reversión real: si renombrar la cuenta falla dentro de la transacción, el perfil no cambia.
  const d = await customer();
  await customerProfileService.updateContact(d, { name: "Cliente Mongo", phone: "0991111111" }, 0);
  await UserModel.updateOne({ _id: d.id }, { $set: { status: "BLOCKED" } });
  await assert.rejects(customerProfileService.updateContact(d, { name: "Nombre Nuevo", phone: "0992222222" }, 1));
  const dProfile = await CustomerProfileModel.findById(d.id).lean();
  assert.equal(dProfile!.phone, "0991111111"); assert.equal(dProfile!.revision, 1);
  assert.equal((await UserModel.findById(d.id).lean())!.name, "Cliente Mongo");
  checks.push("Fallo al renombrar dentro de la transacción: perfil y cuenta sin cambios (rollback real)");

  // 7. Nombre sincronizado en la misma transacción cuando todo va bien.
  const e = await customer();
  await customerProfileService.updateContact(e, { name: "Ñusta Quispe", phone: "0993333333" }, 0);
  assert.equal((await UserModel.findById(e.id).lean())!.name, "Ñusta Quispe");
  checks.push("Nombre Unicode sincronizado con la cuenta en la misma transacción");

  await writeFile(process.env.AUDIT_REPORT_PATH!, JSON.stringify({ ok: true, database: mongoose.connection.name, mongo: (await mongoose.connection.db!.admin().serverInfo()).version, checks }, null, 2));
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  if (mongoose.connection.readyState === 1) { assert(mongoose.connection.name.startsWith("rawenergy_audit_")); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
}
