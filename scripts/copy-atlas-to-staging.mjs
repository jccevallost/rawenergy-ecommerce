import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Lectura snapshot del origen. Solo escribe en una base nueva rawenergy_stage_*.
// Ejecutar desde Azure cuando la red local no esté autorizada por Atlas.
const { default: mongoose } = await import("mongoose")
  .catch(() => import("/home/site/clone-tools/node_modules/mongoose/index.js"));
const { MongoClient, BSON } = mongoose.mongo;
const [sourceName, targetName] = process.argv.slice(2);
assert.match(sourceName ?? "", /^[A-Za-z0-9_-]+$/);
assert.match(targetName ?? "", /^rawenergy_stage_[a-z0-9_]+$/);
assert.notEqual(sourceName, targetName);
assert.ok(!sourceName.startsWith("rawenergy_stage_"));
assert.equal(process.env.RAWENERGY_DEPLOYMENT, "azure-staging");
assert.ok(process.env.MONGODB_URI);
const client = new MongoClient(process.env.MONGODB_URI, { appName: "rawenergy-authorized-stage-copy", serverSelectionTimeoutMS: 30000 });
const reportPath = process.env.COPY_REPORT_PATH ?? "/home/site/rawenergy-copy-report.json";
const report = { status: "incomplete", startedAt: new Date().toISOString(), sourceDatabase: sourceName, targetDatabase: targetName, collections: [] };
const session = client.startSession({ snapshot: true });
const indexDefinition = index => Object.fromEntries(Object.entries(index).filter(([key]) => !["v", "ns"].includes(key)));
const indexSignature = indexes => JSON.stringify(indexes.map(indexDefinition).sort((a, b) => a.name.localeCompare(b.name)));
try {
  await client.connect();
  const source = client.db(sourceName), target = client.db(targetName);
  assert.equal((await target.listCollections({}, { nameOnly: true }).toArray()).length, 0, "La base destino ya existe: no se sobrescribe");
  const collections = (await source.listCollections({}, { nameOnly: false }).toArray()).filter(c => !c.name.startsWith("system."));
  assert.ok(collections.length, "Origen vacío o equivocado");
  assert.ok(collections.every(c => c.type === "collection" && !c.options?.timeseries && !c.options?.capped), "Vistas o colecciones especiales requieren un plan de copia específico");
  const metadata = new Map();
  for (const collection of collections) {
    metadata.set(collection.name, { options: collection.options ?? {}, indexes: await source.collection(collection.name).indexes() });
    await target.createCollection(collection.name, collection.options ?? {});
  }
  for (const collection of collections) {
    const from = source.collection(collection.name), to = target.collection(collection.name);
    const digest = createHash("sha256"); let count = 0, bytes = 0, batch = [], batchBytes = 0;
    const flush = async () => { if (batch.length) { await to.insertMany(batch, { ordered: true }); batch = []; batchBytes = 0; } };
    // El controlador conserva un mismo atClusterTime para todas las lecturas de esta sesión.
    const cursor = from.find({}, { session, raw: true, batchSize: 100, sort: { _id: 1 }, collation: { locale: "simple" } });
    for await (const raw of cursor) {
      assert.ok(Buffer.isBuffer(raw), "El controlador no devolvió BSON bruto");
      const doc = BSON.deserialize(raw, { promoteValues: false, promoteLongs: false, bsonRegExp: true });
      assert.ok(raw.equals(BSON.serialize(doc)), "La serialización alteraría un tipo BSON");
      digest.update(raw); count++; bytes += raw.length;
      if (batchBytes + raw.length > 10 * 1024 * 1024) await flush();
      batch.push(doc); batchBytes += raw.length;
      if (batch.length >= 100) await flush();
    }
    await flush();
    const hash = digest.digest("hex"), copiedDigest = createHash("sha256"); let copied = 0;
    for await (const raw of to.find({}, { raw: true, batchSize: 100, sort: { _id: 1 }, collation: { locale: "simple" } })) { assert.ok(Buffer.isBuffer(raw)); copiedDigest.update(raw); copied++; }
    assert.equal(copied, count, "Conteo diferente en destino");
    assert.equal(copiedDigest.digest("hex"), hash, "Contenido BSON diferente en destino");
    report.collections.push({ name: collection.name, documents: count, bsonBytes: bytes, sha256: hash, contentVerified: true });
    console.info(JSON.stringify({ collection: collection.name, copied: count, bsonVerified: true }));
  }
  const after = (await source.listCollections({}, { nameOnly: false }).toArray()).filter(c => !c.name.startsWith("system."));
  assert.equal(JSON.stringify(after.map(c => c.name).sort()), JSON.stringify(collections.map(c => c.name).sort()), "Cambió el conjunto de colecciones durante la copia");
  for (const collection of collections) {
    const original = metadata.get(collection.name);
    assert.equal(indexSignature(await source.collection(collection.name).indexes()), indexSignature(original.indexes), "Cambió un índice del origen");
    assert.equal(JSON.stringify(after.find(c => c.name === collection.name)?.options ?? {}), JSON.stringify(original.options), "Cambiaron opciones de colección del origen");
    // TTL al final: no caducar documentos del destino antes de verificar su igualdad.
    for (const index of original.indexes) {
      if (index.name === "_id_") continue;
      const { key, ...options } = indexDefinition(index);
      await target.collection(collection.name).createIndex(key, options);
    }
    assert.equal(indexSignature(await target.collection(collection.name).indexes()), indexSignature(original.indexes), "Índices distintos en destino");
    report.collections.find(c => c.name === collection.name).indexesVerified = true;
  }
  report.status = "verified";
  report.completedAt = new Date().toISOString();
  report.snapshotTime = session.snapshotTime?.toString() ?? "snapshot session (controlador)";
  report.totalDocuments = report.collections.reduce((n, c) => n + c.documents, 0);
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.info(JSON.stringify({ status: report.status, collections: report.collections.length, documents: report.totalDocuments, reportPath }));
} catch (error) {
  report.error = { name: error.name, code: error.code ?? null };
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 }).catch(() => {});
  console.error(JSON.stringify({ status: "incomplete", errorName: error.name, code: error.code ?? null, copiedCollections: report.collections.length, reportPath }));
  process.exitCode = 1;
} finally {
  await session.endSession();
  await client.close();
}
