// Sube a otra base (p. ej. MongoDB Atlas) las fotos capturadas con
// scripts/capture-media.mjs y las asigna a las mismas presentaciones.
//
//   npm run fotos:sincronizar -- exports/fotos-<fecha> [--simular] [--cargar-catalogo]
//
// Destino: la API en SYNC_API (por omisión http://localhost:4000), arrancada con
// la base real (`npm run demo -- --con-env`). Acceso: SYNC_EMAIL/SYNC_PASSWORD o
// ADMIN_EMAIL/ADMIN_PASSWORD de apps/api/.env. Se niega a escribir en una API en
// memoria salvo con --permitir-memoria (solo pruebas).
//
// Cada producto se guarda completo con la revisión y el stock que tiene en el
// destino (si alguien lo cambió a la vez, se rechaza en vez de pisarlo). Solo
// cambian las imágenes de las presentaciones capturadas.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import dotenv from "dotenv";
import { initialCatalog } from "../apps/api/src/data/initialCatalog.ts";

type Image = { url: string; alt: string; media: string | null };
type Manifest = {
  source: string;
  photos: Array<{ id: string; file: string }>;
  variants: Array<{ slug: string; title: string; sku: string; flavor: string; size: { value: number; unit: string }; images: Image[] }>;
};
type Variant = { flavor: string; size: { value: number; unit: string }; price: number; compareAtPrice?: number | null; reorderPoint?: number; stock: number; sku: string; images?: Array<{ url: string; alt: string }> };
type Product = { id: string; slug: string; title: string; brand: string; shortDescription: string; ingredients?: string | null; usage?: string | null; warnings?: string | null; productType: string; nutritionalFacts?: unknown; variants: Variant[]; categories: Array<{ name: string; slug: string }>; goals: Array<{ name: string; slug: string }>; featured?: boolean; revision?: number };

const args = process.argv.slice(2);
const flags = new Set(args.filter(arg => arg.startsWith("--")));
const known = ["--simular", "--cargar-catalogo", "--permitir-memoria"];
const unknown = [...flags].filter(flag => !known.includes(flag));
if (unknown.length) { console.error(`Opción desconocida: ${unknown.join(", ")}. Opciones: ${known.join(" ")}`); process.exit(1); }
const dryRun = flags.has("--simular");
const folder = args.find(arg => !arg.startsWith("--")) ?? join("exports", (await readdir("exports")).filter(name => name.startsWith("fotos-")).sort().at(-1) ?? "");
const manifest = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8")) as Manifest;

const fileEnv = dotenv.config({ path: "apps/api/.env", processEnv: {} }).parsed ?? {};
const api = (process.env.SYNC_API ?? "http://localhost:4000").replace(/\/$/, "");
const email = process.env.SYNC_EMAIL ?? fileEnv.ADMIN_EMAIL;
const password = process.env.SYNC_PASSWORD ?? fileEnv.ADMIN_PASSWORD;
if (!email || !password) { console.error("Falta el acceso: define SYNC_EMAIL y SYNC_PASSWORD, o ADMIN_EMAIL y ADMIN_PASSWORD en apps/api/.env."); process.exit(1); }

async function gql<T>(query: string, variables: Record<string, unknown> = {}, token = ""): Promise<T> {
  const response = await fetch(`${api}/graphql`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const body = await response.json() as { data: T; errors?: Array<{ message: string }> };
  if (body.errors) throw new Error(body.errors.map(error => error.message).join("; "));
  return body.data;
}

let token: string;
try { ({ login: { token } } = await gql<{ login: { token: string } }>("mutation($input:LoginInput!){login(input:$input){token}}", { input: { email, password } })); }
catch (error) { console.error(`No se pudo entrar a ${api} como ${email}: ${error instanceof Error ? error.message : error}. ¿Está arrancada con \`npm run demo -- --con-env\`?`); process.exit(1); }
const { storeSettings: { persistence } } = await gql<{ storeSettings: { persistence: string } }>("{ storeSettings { persistence } }", {}, token);
if (persistence !== "mongodb" && !flags.has("--permitir-memoria")) {
  console.error(`La API de destino (${api}) está en memoria, no en MongoDB: las fotos se perderían al cerrarla. Arráncala con \`npm run demo -- --con-env\`.`);
  process.exit(1);
}
if (new URL(api).origin === new URL(manifest.source).origin && !flags.has("--permitir-memoria")) {
  console.error("El destino es la misma API de la que se capturaron las fotos.");
  process.exit(1);
}

const products: Product[] = [];
for (let after: string | undefined; ;) {
  const page = (await gql<{ databaseRecords: { rows: Product[]; pageInfo?: { hasNextPage: boolean; endCursor: string } } }>("query($f:JSON){databaseRecords(entity:\"products\",filters:$f)}", { f: { limit: 100, ...(after ? { after } : {}) } }, token)).databaseRecords;
  products.push(...page.rows);
  if (!page.pageInfo?.hasNextPage) break;
  after = page.pageInfo.endCursor;
}

// Texto alternativo útil si el original era solo el código de la presentación.
const describe = (entry: Manifest["variants"][number], image: Image) =>
  image.alt && image.alt !== entry.sku && !/^[A-Z0-9-]+$/.test(image.alt) ? image.alt : `${entry.title}, ${entry.flavor}, ${entry.size.value} ${entry.size.unit}`.slice(0, 140);
const payloadOf = (product: Product | (typeof initialCatalog)[number]) => ({
  title: product.title, brand: product.brand, slug: product.slug, shortDescription: product.shortDescription, productType: product.productType,
  nutritionalFacts: product.nutritionalFacts ?? null,
  variants: product.variants.map(variant => ({ flavor: variant.flavor, size: { value: variant.size.value, unit: variant.size.unit }, price: variant.price, compareAtPrice: variant.compareAtPrice ?? null, reorderPoint: variant.reorderPoint ?? 5, stock: variant.stock, sku: variant.sku, images: (variant.images ?? []).map(image => ({ url: image.url, alt: image.alt })) })),
  categories: product.categories.map(({ name, slug }) => ({ name, slug })), goals: product.goals.map(({ name, slug }) => ({ name, slug })),
  ingredients: product.ingredients ?? "", usage: product.usage ?? "", warnings: product.warnings ?? "",
  featured: product.featured ?? false
});

// 0. Con --cargar-catalogo, primero se crean en el destino los productos del
// catálogo inicial que falten (precios y stock de referencia: revisarlos en el panel).
const created: string[] = [];
if (flags.has("--cargar-catalogo")) {
  for (const product of initialCatalog.filter(product => !products.some(existing => existing.slug === product.slug))) {
    if (!dryRun) {
      const { upsertProduct } = await gql<{ upsertProduct: { id: string } }>("mutation($payload:JSON!){upsertProduct(payload:$payload){id}}", { payload: payloadOf(product) }, token);
      products.push({ ...(product as unknown as Product), id: upsertProduct.id, revision: 1 });
    }
    created.push(product.slug);
  }
  if (!dryRun && created.length) {
    products.length = 0;
    for (let after: string | undefined; ;) {
      const page = (await gql<{ databaseRecords: { rows: Product[]; pageInfo?: { hasNextPage: boolean; endCursor: string } } }>("query($f:JSON){databaseRecords(entity:\"products\",filters:$f)}", { f: { limit: 100, ...(after ? { after } : {}) } }, token)).databaseRecords;
      products.push(...page.rows);
      if (!page.pageInfo?.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
  }
}

// 1. Qué productos se pueden actualizar. Solo se
// suben las fotos que esos productos usan: nada queda huérfano en el destino.
const slugs = [...new Set(manifest.variants.map(entry => entry.slug))];
const targetOf = (slug: string) => products.find(product => product.slug === slug);
const sourceOf = (slug: string) => targetOf(slug) ?? (dryRun && created.includes(slug) ? initialCatalog.find(product => product.slug === slug) : undefined);
const needed = new Set(manifest.variants.filter(entry => sourceOf(entry.slug)).flatMap(entry => entry.images.flatMap(image => image.media ? [image.media] : [])));
const uploaded = new Map<string, string>();
for (const photo of manifest.photos.filter(photo => needed.has(photo.id))) {
  if (dryRun) { uploaded.set(photo.id, `(se subirá ${photo.file})`); continue; }
  const response = await fetch(`${api}/media`, { method: "POST", headers: { "content-type": "image/webp", authorization: `Bearer ${token}` }, body: await readFile(join(folder, photo.file)) });
  const body = await response.json() as { url?: string; error?: string };
  if (!response.ok || !body.url) throw new Error(`No se pudo subir ${photo.file}: ${body.error ?? response.status}`);
  uploaded.set(photo.id, body.url);
}

// 2. Productos: se reemplazan las imágenes de las presentaciones capturadas.
const report: Array<Record<string, unknown>> = [];
for (const slug of slugs) {
  const entries = manifest.variants.filter(entry => entry.slug === slug);
  const target = targetOf(slug);
  const source = sourceOf(slug);
  if (!source) { report.push({ slug, result: "no existe en el destino; importa el catálogo o usa --cargar-catalogo" }); continue; }
  const payload = payloadOf(source);
  const missingSkus: string[] = [];
  for (const entry of entries) {
    const variant = payload.variants.find(candidate => candidate.sku === entry.sku);
    if (!variant) { missingSkus.push(entry.sku); continue; }
    variant.images = entry.images.map(image => ({ url: image.media ? uploaded.get(image.media)! : image.url, alt: describe(entry, image) }));
  }
  if (dryRun) { report.push({ slug, result: "se le asignarían las fotos", presentaciones: entries.map(entry => entry.sku), missingSkus }); continue; }
  const expectedStocks = target ? target.variants.map(variant => ({ sku: variant.sku, stock: variant.stock })) : undefined;
  await gql("mutation($id:ID,$payload:JSON!,$expectedStocks:JSON,$expectedRevision:Int){upsertProduct(id:$id,payload:$payload,expectedStocks:$expectedStocks,expectedRevision:$expectedRevision){id}}",
    { id: target?.id ?? null, payload, expectedStocks: expectedStocks ?? null, expectedRevision: target ? target.revision ?? 0 : null }, token);
  report.push({ slug, result: "fotos asignadas", presentaciones: entries.map(entry => entry.sku), missingSkus });
}
console.log(JSON.stringify({ ok: true, destino: api, persistencia: persistence, simulado: dryRun, catalogoCreado: created.length, fotos: uploaded.size, productos: report,
  ...(created.length ? { aviso: "Los productos creados tienen precios y stock de referencia: revísalos en el panel antes de vender." } : {}) }, null, 2));
