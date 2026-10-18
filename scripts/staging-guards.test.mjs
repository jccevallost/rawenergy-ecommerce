// Uso: node --test scripts/staging-guards.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { stagingProblems } from "./staging-guards.mjs";

const base = {
  NODE_ENV: "production", STAFF_MFA: "required", STORE_WHATSAPP: "",
  AUTH_TOKEN_SECRET: "x".repeat(40), ADMIN_EMAIL: "stage@example.test", ADMIN_PASSWORD: "Stage-only-123!"
};
const general = { ...base, RAWENERGY_DEPLOYMENT: "azure-staging", CUSTOMER_ACCOUNTS: "off" };
const cuentas = { ...base, RAWENERGY_DEPLOYMENT: "azure-staging-cuentas", CUSTOMER_ACCOUNTS: "on", MAIL_MODE: "simulated" };

test("el perfil general sigue exigiendo cuentas apagadas", () => {
  assert.deepEqual(stagingProblems("azure-staging", general, "rawenergy_stage_20261016"), []);
  assert.notDeepEqual(stagingProblems("azure-staging", { ...general, CUSTOMER_ACCOUNTS: "on" }, "rawenergy_stage_20261016"), []);
});

test("el piloto de cuentas arranca solo con correo simulado y base sintética", () => {
  assert.deepEqual(stagingProblems("azure-staging-cuentas", cuentas, "rawenergy_stage_cuentas_20261016"), []);
  assert.deepEqual(stagingProblems("azure-staging-cuentas", { ...cuentas, CUSTOMER_ACCOUNTS: "off" }, "rawenergy_stage_cuentas_20261016"), []);
  assert.ok(stagingProblems("azure-staging-cuentas", { ...cuentas, MAIL_MODE: "smtp" }, "rawenergy_stage_cuentas_x").some(p => p.includes("MAIL_MODE")));
  assert.ok(stagingProblems("azure-staging-cuentas", { ...cuentas, CUSTOMER_ACCOUNTS: undefined }, "rawenergy_stage_cuentas_x").length > 0);
});

test("el piloto rechaza la copia de Atlas, producción y otras bases", () => {
  for (const db of ["rawenergy_stage_copy_20261016", "rawenergy_stage_20261016", "rawenergy", "test", "", undefined]) {
    assert.ok(stagingProblems("azure-staging-cuentas", cuentas, db).length > 0, String(db));
  }
});

test("un artefacto de un perfil no arranca con otro perfil ni con uno desconocido", () => {
  assert.ok(stagingProblems("azure-staging", { ...general, RAWENERGY_DEPLOYMENT: "azure-staging-cuentas" }, "rawenergy_stage_x").length > 0);
  assert.ok(stagingProblems("azure-staging-cuentas", { ...cuentas, RAWENERGY_DEPLOYMENT: "azure-staging" }, "rawenergy_stage_cuentas_x").length > 0);
  assert.ok(stagingProblems("produccion", cuentas, "rawenergy_stage_cuentas_x").length > 0);
});

test("producción: solo la base rawenergy_ec, con secreto propio, sin correo simulado ni cabecera de Cloudflare", () => {
  const prod = { NODE_ENV: "production", RAWENERGY_DEPLOYMENT: "azure-produccion", AUTH_TOKEN_SECRET: "y".repeat(48), SMTP_HOST: "smtp.real.test", STORE_WHATSAPP: "593999999999" };
  assert.deepEqual(stagingProblems("azure-produccion", prod, "rawenergy_ec"), []);
  for (const db of ["rawenergy_stage_copy_20261016", "rawenergy_stage_cuentas_x", "test", undefined]) assert.ok(stagingProblems("azure-produccion", prod, db).length > 0, String(db));
  assert.ok(stagingProblems("azure-produccion", { ...prod, MAIL_MODE: "simulated" }, "rawenergy_ec").length > 0);
  assert.ok(stagingProblems("azure-produccion", { ...prod, CLIENT_IP_HEADER: "cf-connecting-ip" }, "rawenergy_ec").length > 0);
  assert.ok(stagingProblems("azure-produccion", { ...prod, AUTH_TOKEN_SECRET: "corto" }, "rawenergy_ec").length > 0);
  assert.ok(stagingProblems("azure-produccion", { ...prod, NODE_ENV: "development" }, "rawenergy_ec").length > 0);
  assert.ok(stagingProblems("azure-produccion", { ...prod, RAWENERGY_DEPLOYMENT: "azure-staging" }, "rawenergy_ec").length > 0);
  // Un artefacto de staging no arranca contra producción.
  assert.ok(stagingProblems("azure-staging", { ...prod, RAWENERGY_DEPLOYMENT: "azure-staging" }, "rawenergy_ec").length > 0);
});

test("ambos perfiles conservan MFA, canales apagados y credenciales propias", () => {
  for (const [profile, env, db] of [["azure-staging", general, "rawenergy_stage_x"], ["azure-staging-cuentas", cuentas, "rawenergy_stage_cuentas_x"]]) {
    assert.ok(stagingProblems(profile, { ...env, STAFF_MFA: "optional" }, db).length > 0);
    assert.ok(stagingProblems(profile, { ...env, NODE_ENV: "development" }, db).length > 0);
    assert.ok(stagingProblems(profile, { ...env, SMTP_HOST: "smtp.real.test" }, db).length > 0);
    assert.ok(stagingProblems(profile, { ...env, BANK_ACCOUNT_NUMBER: "123" }, db).length > 0);
    assert.ok(stagingProblems(profile, { ...env, STORE_WHATSAPP: undefined }, db).length > 0);
    assert.ok(stagingProblems(profile, { ...env, ADMIN_PASSWORD: "" }, db).length > 0);
  }
});
