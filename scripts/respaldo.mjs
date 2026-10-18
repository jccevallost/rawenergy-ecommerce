// RESP-01: respaldo local gratuito de la base de MongoDB (Atlas Free incluido) y su prueba de restauración.
//
//   npm run respaldo                      → lee la base (solo lectura) y guarda un archivo cifrado
//   npm run respaldo:probar -- <archivo>  → restaura la copia en una base temporal de este equipo y la verifica
//
// La conexión se toma de RESPALDO_MONGODB_URI o, si no existe, de MONGODB_URI en apps/api/.env; nunca se
// imprime ni se guarda en el archivo. La contraseña de cifrado se pide al ejecutar (o RESPALDO_CLAVE) y no
// se guarda en ningún lugar: sin ella la copia no se puede abrir. Formato: una línea de cabecera JSON y
// después los datos en NDJSON/EJSON comprimidos con gzip y cifrados con AES-256-GCM (clave derivada con scrypt).
// La copia contiene datos personales de clientes: guárdala en un disco externo o nube personal, no la compartas.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { createGunzip, createGzip } from "node:zlib";
import { MongoClient, BSON } from "mongodb";

const { EJSON } = BSON;
const FORMAT = "rawenergy-respaldo", VERSION = 1, KDF = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const [command = "crear", ...args] = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

function connectionString() {
  if (process.env.RESPALDO_MONGODB_URI) return process.env.RESPALDO_MONGODB_URI;
  const file = resolve("apps/api/.env");
  if (existsSync(file)) {
    const line = readFileSync(file, "utf8").split(/\r?\n/).find(l => /^\s*MONGODB_URI\s*=/.test(l));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("No encontré la conexión. Define RESPALDO_MONGODB_URI o MONGODB_URI en apps/api/.env.");
}
async function askSecret(prompt) {
  if (process.env.RESPALDO_CLAVE) return process.env.RESPALDO_CLAVE;
  if (!process.stdin.isTTY) throw new Error("Escribe la contraseña en una terminal o define RESPALDO_CLAVE.");
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const write = rl._writeToOutput.bind(rl); rl._writeToOutput = (text) => write(text.startsWith(prompt) ? prompt : "");
  const answer = await new Promise(r => rl.question(prompt, r)); rl.close(); process.stdout.write("\n");
  return answer;
}
const keyFrom = (password, salt) => scryptSync(password, salt, 32, KDF);

async function create() {
  const password = await askSecret("Contraseña para cifrar la copia (mínimo 12 caracteres): ");
  if (password.length < 12) throw new Error("La contraseña debe tener al menos 12 caracteres.");
  if (!process.env.RESPALDO_CLAVE && password !== await askSecret("Repítela: ")) throw new Error("Las contraseñas no coinciden.");
  const folder = resolve(option("--carpeta") ?? join(homedir(), "RawEnergy-respaldos"));
  await mkdir(folder, { recursive: true });
  const client = new MongoClient(connectionString(), { readPreference: "secondaryPreferred", appName: "rawenergy-respaldo" });
  await client.connect();
  try {
    const db = client.db();
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
    const file = join(folder, `rawenergy-${db.databaseName}-${stamp}.respaldo`);
    const salt = randomBytes(16), iv = randomBytes(12);
    const header = { format: FORMAT, version: VERSION, database: db.databaseName, createdAt: new Date().toISOString(), cipher: "aes-256-gcm", kdf: { name: "scrypt", ...KDF, salt: salt.toString("base64") }, iv: iv.toString("base64") };
    const cipher = createCipheriv("aes-256-gcm", keyFrom(password, salt), iv);
    cipher.setAAD(Buffer.from(JSON.stringify(header)));
    const collections = (await db.listCollections({}, { nameOnly: false }).toArray()).filter(c => c.type !== "view" && !c.name.startsWith("system."));
    const counts = {};
    async function* lines() {
      yield JSON.stringify({ type: "collections", names: collections.map(c => c.name) }) + "\n";
      for (const { name, options } of collections) {
        const indexes = await db.collection(name).indexes();
        yield JSON.stringify({ type: "collection", name, options: options ?? {}, indexes: EJSON.serialize(indexes) }) + "\n";
        counts[name] = 0;
        for await (const doc of db.collection(name).find({}, { batchSize: 500 })) { counts[name]++; yield JSON.stringify({ c: name, d: EJSON.serialize(doc, { relaxed: false }) }) + "\n"; }
      }
      yield JSON.stringify({ type: "end", counts }) + "\n";
    }
    const out = createWriteStream(file, { mode: 0o600 });
    out.write(JSON.stringify(header) + "\n");
    await pipeline(Readable.from(lines()), createGzip(), cipher, out, { end: false });
    await new Promise((r, j) => out.end(cipher.getAuthTag(), e => e ? j(e) : r()));
    const size = (await stat(file)).size;
    console.log(`Copia guardada: ${file}`);
    console.log(`Tamaño: ${(size / 1048576).toFixed(1)} MB · Colecciones: ${collections.length} · Documentos: ${Object.values(counts).reduce((a, b) => a + b, 0)}`);
    console.log("Guárdala también en un disco externo o en tu nube personal. Sin la contraseña no se puede abrir.");
  } finally { await client.close(); }
}

/** Devuelve la cabecera y un flujo con las líneas descifradas y descomprimidas. Falla si la contraseña o el archivo no son correctos. */
async function openBackup(file, password) {
  const handle = await open(file, "r");
  const size = (await handle.stat()).size;
  const head = Buffer.alloc(Math.min(4096, size)); await handle.read(head, 0, head.length, 0);
  const newline = head.indexOf(10);
  if (newline < 0) throw new Error("El archivo no es una copia de RawEnergy.");
  const header = JSON.parse(head.subarray(0, newline).toString("utf8"));
  if (header.format !== FORMAT || header.version !== VERSION) throw new Error("Formato de copia no reconocido.");
  const tag = Buffer.alloc(16); await handle.read(tag, 0, 16, size - 16); await handle.close();
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(password, Buffer.from(header.kdf.salt, "base64")), Buffer.from(header.iv, "base64"));
  decipher.setAAD(Buffer.from(JSON.stringify(header))); decipher.setAuthTag(tag);
  // pipeline destruye toda la cadena ante un error (contraseña incorrecta, archivo dañado o truncado),
  // así la lectura de líneas termina con ese error en lugar de quedarse esperando.
  const gunzip = createGunzip();
  const done = pipeline(createReadStream(file, { start: newline + 1, end: size - 17 }), decipher, gunzip);
  return { header, lines: createInterface({ input: gunzip, crlfDelay: Infinity }), done };
}

async function probe() {
  const file = args.find(a => !a.startsWith("--"));
  if (!file) throw new Error("Indica el archivo: npm run respaldo:probar -- <archivo>.respaldo");
  const password = await askSecret("Contraseña de la copia: ");
  let MongoMemoryReplSet;
  try { ({ MongoMemoryReplSet } = await import("mongodb-memory-server")); } catch { throw new Error("Para probar la copia instala, sin guardarlo en el proyecto: npm i --no-save mongodb-memory-server@11"); }
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, name: "respaldo", storageEngine: "wiredTiger" } });
  const client = new MongoClient(replSet.getUri());
  const report = { file, collections: {}, checks: [] };
  try {
    await client.connect();
    const { header, lines, done } = await openBackup(file, password);
    let failure; done.catch(e => { failure = e; });
    const db = client.db(`prueba_${header.database}`.slice(0, 60));
    let end, batch = [], current;
    const flush = async () => { if (batch.length) { await db.collection(current).insertMany(batch, { ordered: false }); batch = []; } };
    try { for await (const line of lines) {
      if (!line) continue;
      const row = JSON.parse(line);
      if (row.type === "collection") {
        await flush(); current = row.name;
        await db.createCollection(row.name).catch(() => {});
        const indexes = EJSON.deserialize(row.indexes).filter(i => i.name !== "_id_").map(({ v, ns, ...index }) => index);
        if (indexes.length) await db.collection(row.name).createIndexes(indexes);
        report.collections[row.name] = { indexes: indexes.length + 1 };
      } else if (row.type === "end") { await flush(); end = row; }
      else if (row.c) { batch.push(EJSON.deserialize(row.d, { relaxed: false })); if (batch.length >= 500) await flush(); }
    } } catch (error) { failure ??= error; }
    await done.catch(() => {});
    if (failure) throw new Error("La contraseña no es correcta o el archivo está dañado.");
    if (!end) throw new Error("La copia está incompleta: falta el cierre. Vuelve a generarla.");
    for (const [name, expected] of Object.entries(end.counts)) {
      const restored = await db.collection(name).countDocuments();
      report.collections[name] = { ...report.collections[name], expected, restored };
      if (restored !== expected) throw new Error(`La colección ${name} restauró ${restored} de ${expected} documentos.`);
    }
    report.checks.push("Todas las colecciones restauradas con el mismo número de documentos e índices");
    const products = db.collection("products");
    if (await products.countDocuments()) {
      const mismatched = await products.aggregate([{ $unwind: "$variants" }, { $match: { "variants.lots.0": { $exists: true } } }, { $project: { sku: "$variants.sku", stock: "$variants.stock", lots: { $sum: "$variants.lots.quantity" } } }, { $match: { $expr: { $ne: ["$stock", "$lots"] } } }, { $count: "n" }]).toArray();
      if (mismatched[0]?.n) throw new Error(`${mismatched[0].n} variantes tienen stock distinto de la suma de sus lotes.`);
      report.checks.push("Stock de cada variante igual a la suma de sus lotes");
    }
    if ((await db.listCollections({ name: "media" }).toArray()).length) report.checks.push(`Fotos restauradas: ${await db.collection("media").countDocuments()}`);
    console.log(`Copia del ${header.createdAt} de la base ${header.database}: restauración correcta en una base temporal.`);
    for (const [name, c] of Object.entries(report.collections)) console.log(`  ${name}: ${c.restored ?? 0} documentos, ${c.indexes} índices`);
    for (const check of report.checks) console.log(`✓ ${check}`);
    console.log(JSON.stringify({ ok: true, collections: Object.keys(report.collections).length }));
  } finally { await client.close(); await replSet.stop({ doCleanup: true, force: true }); }
}

try {
  if (command === "crear") await create();
  else if (command === "probar") await probe();
  else throw new Error("Uso: node scripts/respaldo.mjs crear | probar <archivo>");
} catch (error) {
  console.error(`No se completó: ${error.message}`);
  process.exitCode = 1;
}
