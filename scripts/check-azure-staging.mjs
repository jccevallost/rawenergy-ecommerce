import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";

// No imprime credenciales, tokens ni datos comerciales. Solo API de staging.
const settingsPath = process.argv[2] ?? "/private/tmp/rawenergy-azure-stage-private/settings.json";
const settings = JSON.parse(await readFile(settingsPath, "utf8"));
const copy = await readFile(join(dirname(settingsPath), "atlas-copy-report.json"), "utf8").then(JSON.parse).catch(() => null);
const usesCopy = copy?.status === "verified" && new URL(settings.MONGODB_URI).pathname === `/${copy.targetDatabase}`;
const base = new URL(settings.PUBLIC_API_URL);
assert.equal(base.protocol, "https:");
assert.match(base.hostname, /^rawenergy-api-stage-[a-z0-9-]+\.azurewebsites\.net$/);
const results = [];
const request = (path, options = {}) => fetch(new URL(path, base), { ...options, signal: AbortSignal.timeout(30000) });
const gql = async (query, variables = {}, token) => {
  const response = await request("/graphql", {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  assert.equal(response.status, 200);
  return response.json();
};
const health = await request("/health");
assert.equal(health.status, 200);
const status = await health.json();
assert.equal(status.status, "ok");
assert.equal(status.indexes, "ok");
assert.equal(health.headers.get("x-content-type-options"), "nosniff");
assert.ok(health.headers.get("strict-transport-security"));
results.push("Salud, índices y cabeceras de seguridad correctos");
const products = await gql("query { searchProducts(pagination:{first:1}) { totalCount } }");
assert.equal(products.errors, undefined);
if (usesCopy) {
  const sourceCount = copy.collections.find(c => c.name === "products")?.documents;
  assert.ok(products.data.searchProducts.totalCount > 0 && products.data.searchProducts.totalCount <= sourceCount);
  results.push(`Catálogo copiado disponible: ${products.data.searchProducts.totalCount} productos visibles`);
} else {
  assert.equal(products.data.searchProducts.totalCount, 0);
  results.push("Catálogo de prueba vacío, sin catálogo real ni demo");
}
const denied = await gql("query { supplyOverview }");
assert.ok(denied.errors?.length);
assert.equal(denied.data?.supplyOverview ?? null, null);
results.push("Compras privadas rechazadas sin sesión");
for (const [origin, allowed] of [["http://localhost:5174", true], ["https://origin-no-autorizado.example", false]]) {
  const response = await request("/graphql", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
  assert.equal(response.headers.get("access-control-allow-origin"), allowed ? origin : null);
}
results.push("CORS permite el panel local y no autoriza otro origen");
const login = await gql("mutation($input:LoginInput!) { login(input:$input) { token user { role twoFactorRequired twoFactorEnabled } } }", { input: { email: settings.ADMIN_EMAIL, password: settings.ADMIN_PASSWORD } });
assert.equal(login.errors, undefined);
assert.equal(login.data.login.user.role, "ADMIN");
assert.equal(login.data.login.user.twoFactorRequired, true);
assert.equal(login.data.login.user.twoFactorEnabled, false);
const token = login.data.login.token;
assert.ok(token);
const pending = await gql("query { supplyOverview }", {}, token);
assert.ok(pending.errors?.some(error => error.extensions?.code === "MFA_SETUP_REQUIRED"));
results.push("Administrador exclusivo inicia sesión; MFA bloquea operación antes de activarlo");
const me = await gql("query { me { role twoFactorRequired } }", {}, token);
assert.equal(me.errors, undefined);
assert.equal(me.data.me.role, "ADMIN");
results.push("Sesión consultable sin exponer token ni datos del usuario");
console.log(JSON.stringify({ base: base.origin, checkedAt: new Date().toISOString(), passed: results.length, results }, null, 2));
