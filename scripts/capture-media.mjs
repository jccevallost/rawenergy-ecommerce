// Guarda en disco las fotos subidas a una API en marcha (p. ej. la demo en
// memoria) y a qué producto y presentación está asignada cada una, para
// subirlas después a otra base con scripts/sync-media.mjs.
//
//   node scripts/capture-media.mjs                      → demo local (admin@demo.local)
//   CAPTURE_API=… CAPTURE_EMAIL=… CAPTURE_PASSWORD=… node scripts/capture-media.mjs
//
// Resultado: exports/fotos-<fecha>/ con un .webp por foto y manifest.json.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const api = (process.env.CAPTURE_API ?? "http://localhost:4000").replace(/\/$/, "");
const email = process.env.CAPTURE_EMAIL ?? "admin@demo.local";
const password = process.env.CAPTURE_PASSWORD ?? "Demo-RawEnergy-2026";

async function gql(query, variables = {}, token = "") {
  const response = await fetch(`${api}/graphql`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const body = await response.json();
  if (body.errors) throw new Error(body.errors.map(error => error.message).join("; "));
  return body.data;
}

const { login: { token } } = await gql("mutation($input:LoginInput!){login(input:$input){token}}", { input: { email, password } });
const records = entity => async filters => (await gql("query($entity:String!,$filters:JSON){databaseRecords(entity:$entity,filters:$filters)}", { entity, filters }, token)).databaseRecords;

// Todas las fotos, página a página.
const media = [];
for (let offset = 0; ; offset += 100) {
  const page = await records("media")({ offset, limit: 100 });
  media.push(...page.rows);
  if (media.length >= page.total || !page.rows.length) break;
}
// Todos los productos (activos y archivados) con sus imágenes.
const products = [];
for (let after; ;) {
  const page = await records("products")({ limit: 100, ...(after ? { after } : {}) });
  products.push(...page.rows);
  if (!page.pageInfo?.hasNextPage) break;
  after = page.pageInfo.endCursor;
}

const idOf = url => /\/media\/([a-f0-9]{32})(?:[?#]|$)/.exec(url)?.[1];
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = join("exports", `fotos-${stamp}`);
await mkdir(out, { recursive: true });
const manifest = { capturedAt: new Date().toISOString(), source: api, photos: [] };
for (const item of media) {
  const response = await fetch(`${api}/media/${item.id}`);
  if (!response.ok) throw new Error(`No se pudo descargar ${item.id}: ${response.status}`);
  const file = `${item.id}.webp`;
  await writeFile(join(out, file), Buffer.from(await response.arrayBuffer()));
  const usedBy = products.flatMap(product => product.variants.flatMap(variant => (variant.images ?? []).flatMap((image, position) =>
    idOf(image.url) === item.id ? [{ slug: product.slug, title: product.title, sku: variant.sku, position, alt: image.alt ?? "" }] : [])));
  manifest.photos.push({ id: item.id, file, label: item.label ?? "", width: item.width, height: item.height, bytes: item.size, usedBy });
}
// Lista completa de imágenes de cada presentación que usa alguna foto subida,
// en su orden: la sincronización la replica tal cual en la otra base.
const captured = new Set(media.map(item => item.id));
manifest.variants = products.flatMap(product => product.variants
  .filter(variant => (variant.images ?? []).some(image => captured.has(idOf(image.url))))
  .map(variant => ({ slug: product.slug, title: product.title, sku: variant.sku, flavor: variant.flavor, size: variant.size, images: variant.images.map(image => ({ url: image.url, alt: image.alt ?? "", media: idOf(image.url) ?? null })) })));
await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
const unused = manifest.photos.filter(photo => !photo.usedBy.length).length;
console.log(JSON.stringify({ ok: true, folder: out, photos: manifest.photos.length, assignments: manifest.photos.reduce((sum, photo) => sum + photo.usedBy.length, 0), unused }));
