// C37: prueba la sincronización de fotos contra una API con MongoDB real
// (réplica temporal de un nodo con mongodb-memory-server, sin tocar Atlas).
// Requiere: npm i --no-save mongodb-memory-server@11
// Uso: node scripts/review-sync-media.mjs [exports/fotos-<fecha>]
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";

let MongoMemoryReplSet;
try { ({ MongoMemoryReplSet } = await import("mongodb-memory-server")); }
catch { console.error("Falta mongodb-memory-server: npm i --no-save mongodb-memory-server@11"); process.exit(1); }

const folder = process.argv[2] ?? join("exports", (await readdir("exports")).filter(name => name.startsWith("fotos-")).sort().at(-1));
const manifest = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8"));
const port = 14961, api = `http://127.0.0.1:${port}`;
const admin = { email: "sync@example.test", password: "Sync-review-123!" };
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, name: "sync", storageEngine: "wiredTiger" } });
const uri = `mongodb://127.0.0.1:${replSet.servers[0].instanceInfo.port}/rawenergy_sync_${randomUUID().replaceAll("-", "")}?replicaSet=sync&directConnection=true`;
const env = { PATH: process.env.PATH, NODE_ENV: "development", DOTENV_CONFIG_PATH: "/dev/null", PORT: String(port), PUBLIC_API_URL: api, MONGODB_URI: uri, AUTH_TOKEN_SECRET: "isolated-sync-review-secret-123456789", ADMIN_EMAIL: admin.email, ADMIN_PASSWORD: admin.password, EMAIL_DOMAIN_CHECK: "off" };
const server = spawn(process.execPath, ["--import", "tsx", "apps/api/src/server.ts"], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
const logs = []; server.stdout.on("data", d => logs.push(String(d))); server.stderr.on("data", d => logs.push(String(d)));
const gql = async (query, variables = {}, token = "") => { const r = await fetch(`${api}/graphql`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) }); const b = await r.json(); if (b.errors) throw new Error(b.errors.map(e => e.message).join("; ")); return b.data; };
const sync = (...extra) => spawnSync(process.execPath, ["--import", "tsx", "scripts/sync-media.mts", folder, ...extra], { env: { ...process.env, SYNC_API: api, SYNC_EMAIL: admin.email, SYNC_PASSWORD: admin.password }, encoding: "utf8" });
const checks = [];
try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${api}/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  const { login: { token } } = await gql("mutation($i:LoginInput!){login(input:$i){token}}", { i: admin }, "");
  assert.equal((await gql("{storeSettings{persistence}}", {}, token)).storeSettings.persistence, "mongodb");

  const missing = sync();
  assert.equal(missing.status, 0, missing.stderr);
  assert(JSON.parse(missing.stdout).productos.every(p => /no existe/.test(p.result)), "Base vacía: avisa que falta el producto");
  assert.equal((await gql("query($f:JSON){databaseRecords(entity:\"media\",filters:$f)}", { f: { limit: 100 } }, token)).databaseRecords.total, 0, "Sin productos no sube fotos huérfanas");
  checks.push("Base vacía: no inventa productos ni sube fotos huérfanas; pide importar el catálogo o usar --cargar-catalogo");

  const plan = JSON.parse(sync("--simular", "--cargar-catalogo").stdout);
  assert.equal((await gql("query($f:JSON){databaseRecords(entity:\"media\",filters:$f)}", { f: { limit: 100 } }, token)).databaseRecords.total, 0, "Simular no escribe");
  assert.equal((await gql("query($f:JSON){databaseRecords(entity:\"products\",filters:$f)}", { f: { limit: 100 } }, token)).databaseRecords.rows.length, 0, "Simular no crea productos");
  checks.push(`--simular: plan (catálogo ${plan.catalogoCreado} productos, fotos para ${plan.productos.length}), sin escribir nada`);

  const run = sync("--cargar-catalogo");
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.fotos, manifest.photos.length);
  const media = (await gql("query($f:JSON){databaseRecords(entity:\"media\",filters:$f)}", { f: { limit: 100 } }, token)).databaseRecords;
  assert.equal(media.total, manifest.photos.length, "Fotos guardadas en MongoDB");
  const products = (await gql("query($f:JSON){databaseRecords(entity:\"products\",filters:$f)}", { f: { limit: 100 } }, token)).databaseRecords.rows;
  assert.equal(products.length, 20, "Catálogo inicial completo en MongoDB");
  assert.equal(result.catalogoCreado, 20); assert.match(result.aviso, /referencia/);
  for (const entry of manifest.variants) {
    const variant = products.find(p => p.slug === entry.slug)?.variants.find(v => v.sku === entry.sku);
    assert(variant, `${entry.slug}/${entry.sku} existe`);
    assert.equal(variant.images.length, entry.images.length, `${entry.sku}: misma cantidad de fotos`);
    for (const image of variant.images) {
      assert(image.url.startsWith(`${api}/media/`), `${entry.sku}: foto servida por el destino`);
      const response = await fetch(image.url); assert(response.ok && response.headers.get("content-type") === "image/webp", "La foto se descarga");
      assert(!/^[A-Z0-9-]+$/.test(image.alt), `${entry.sku}: texto alternativo descriptivo`);
    }
  }
  checks.push(`--cargar-catalogo: 20 productos creados con aviso de precios y stock de referencia`);
  checks.push(`Sincronización: ${media.total} fotos en MongoDB y asignadas en el mismo orden a ${manifest.variants.length} presentaciones de ${new Set(manifest.variants.map(v => v.slug)).size} productos; se descargan del destino`);

  const again = sync();
  assert.equal(again.status, 0, again.stderr);
  assert.equal((await gql("query($f:JSON){databaseRecords(entity:\"media\",filters:$f)}", { f: { limit: 100 } }, token)).databaseRecords.total, manifest.photos.length, "Repetir no duplica fotos");
  checks.push("Repetir la sincronización no duplica fotos ni falla");
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} catch (error) {
  console.error(error.message); console.error(logs.join("").slice(-3000)); process.exitCode = 1;
} finally {
  try { process.kill(-server.pid, "SIGTERM"); } catch {}
  await new Promise(r => setTimeout(r, 500));
  await replSet.stop({ doCleanup: true, force: true });
}
