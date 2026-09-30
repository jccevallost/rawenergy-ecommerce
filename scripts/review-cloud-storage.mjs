// Verifies expense transactions in a NEW temporary database on the configured cluster.
// Never uses the business database. Deletes only the database created by this run.
// Run: node --import tsx scripts/review-cloud-storage.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const settings = dotenv.parse(await readFile(new URL('../apps/api/.env', import.meta.url)));
assert(settings.MONGODB_URI, 'Falta la conexión a MongoDB');
const uri = new URL(settings.MONGODB_URI);
const databaseName = `rawenergy_verify_${randomUUID().replaceAll('-', '')}`;
uri.pathname = `/${databaseName}`;
process.env.DOTENV_CONFIG_PATH = '/dev/null';
process.env.MONGODB_URI = uri.toString();
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'storage-review@example.com';
process.env.ADMIN_PASSWORD = randomBytes(24).toString('hex');
process.env.AUTH_TOKEN_SECRET = randomBytes(32).toString('hex');
let owned = false, server;
const connect = async () => {
  await mongoose.connect(uri.toString(), { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, maxPoolSize: 4 });
  assert.equal(mongoose.connection.db.databaseName, databaseName);
};
try {
  await connect();
  assert.equal((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).length, 0, 'No se usará una base que ya contenga datos');
  owned = true;
  const { ApolloServer } = await import('@apollo/server');
  const { resolvers } = await import('../apps/api/src/graphql/resolvers.ts');
  const { typeDefs } = await import('../apps/api/src/graphql/typeDefs.ts');
  const { authService } = await import('../apps/api/src/services/auth.service.ts');
  const { expenseService } = await import('../apps/api/src/services/expense.service.ts');
  const { auditService } = await import('../apps/api/src/services/audit.service.ts');
  // Sequential initialization keeps the verification gentle on a small Atlas cluster.
  for (const model of Object.values(mongoose.models)) await model.init();
  authService.setPersistence(true); await authService.bootstrapAdmin();
  const admin = (await authService.users('ADMIN'))[0];
  server = new ApolloServer({ typeDefs, resolvers });
  const execute = async (query, variables) => {
    const response = await server.executeOperation({ query, variables }, { contextValue: { user: admin, requestId: randomUUID() } });
    assert.equal(response.body.kind, 'single'); return response.body.singleResult;
  };
  const query = 'mutation($id:ID!,$input:JSON!,$revision:Int){saveExpense(id:$id,input:$input,revision:$revision)}';
  const id = randomUUID(), date = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  const input = { date, category: 'ADVERTISING', amount: 17.50, description: 'Gasto de comprobación aislada', reference: 'TEMPORAL' };
  assert.equal((await execute(query, { id, input })).errors, undefined);
  assert.equal((await execute(query, { id, input })).errors, undefined);
  assert.equal(await mongoose.connection.db.collection('expenses').countDocuments({ _id: id }), 1);
  const corrected = await Promise.all([20, 30].map(amount => execute(query, { id, input: { ...input, amount }, revision: 0 })));
  assert.equal(corrected.filter(r => !r.errors).length, 1, 'Una sola corrección concurrente debe ser aceptada');
  const record = await expenseService.get(id); assert.equal(record.revision, 1);
  const events = await auditService.list({ entity: 'expenses', status: 'SUCCESS', search: id });
  assert(events.rows.some(e => e.before?.amount === 17.50 && e.after?.amount === record.amount));
  const failedId = randomUUID(), original = auditService.record.bind(auditService);
  auditService.record = async event => { if (event.entity === 'expenses' && event.status === 'SUCCESS') throw new Error('Fallo de auditoría simulado'); return original(event); };
  try { assert((await execute(query, { id: failedId, input })).errors); } finally { auditService.record = original; }
  assert.equal(await expenseService.get(failedId), null, 'El gasto debe revertirse si falla la auditoría');
  assert.equal((await execute('mutation($id:ID!){voidExpense(id:$id,revision:1,reason:"Anulación de comprobación aislada")}', { id })).errors, undefined);
  await mongoose.disconnect(); await connect();
  const persisted = await mongoose.connection.db.collection('expenses').findOne({ _id: id });
  assert.equal(persisted.status, 'VOID'); assert.equal(persisted.revision, 2);
  assert.equal(await mongoose.connection.db.collection('expenses').countDocuments({ status: 'ACTIVE' }), 0);
  console.log(JSON.stringify({ ok: true, checks: ['alta persistente', 'reintento sin duplicar', 'conflicto de edición', 'auditoría con diferencias', 'rollback transaccional', 'anulación', 'persistencia tras reconectar'] }));
} catch (error) {
  console.error(String(error.message).replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[URI oculta]'));
  process.exitCode = 1;
} finally {
  await server?.stop();
  if (owned) {
    try {
      if (mongoose.connection.readyState !== 1) await connect();
      assert.equal(mongoose.connection.db.databaseName, databaseName);
      assert(databaseName.startsWith('rawenergy_verify_'));
      await mongoose.connection.db.dropDatabase();
      console.log('Base temporal eliminada; la base del negocio no se modificó.');
    } catch (error) { console.error(`No se pudo retirar la base temporal ${databaseName}: ${error.name}`); process.exitCode = 1; }
  }
  await mongoose.disconnect();
}
