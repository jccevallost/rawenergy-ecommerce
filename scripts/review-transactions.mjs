// Scratch MongoDB only. No existing containers/volumes/databases are modified.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const name = `rawenergy-audit-${randomUUID()}`;
const database = `rawenergy_audit_${randomUUID().replaceAll('-', '')}`;
const out = await mkdtemp(join(tmpdir(), 'rawenergy-transactions-'));
const run = (args) => { const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 }); if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Docker falló'); return result.stdout.trim(); };
let started = false;
try {
  run(['info', '--format', '{{.ServerVersion}}']);
  // --pull=never avoids an implicit download; install mongo:8 explicitly if absent.
  run(['run', '--pull=never', '--detach', '--name', name, '--publish', '127.0.0.1::27017', '--tmpfs', '/data/db:rw,size=1g', 'mongo:8', 'mongod', '--replSet', 'audit', '--bind_ip_all', '--wiredTigerCacheSizeGB', '0.25']); started = true;
  const port = run(['port', name, '27017/tcp']).split(':').at(-1);
  for (let i = 0; ; i++) {
    try { run(['exec', name, 'mongosh', '--quiet', '--eval', 'try { rs.status() } catch(e) { rs.initiate({_id:"audit",members:[{_id:0,host:"localhost:27017"}]}) }']); break; }
    catch (error) { if (i >= 20) throw error; await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  for (let i = 0; ; i++) {
    const primary = run(['exec', name, 'mongosh', '--quiet', '--eval', 'db.hello().isWritablePrimary']);
    if (primary === 'true') break;
    if (i >= 30) throw new Error('Replica set no llegó a PRIMARY');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const env = { PATH: process.env.PATH, NODE_ENV: 'test', DOTENV_CONFIG_PATH: '/dev/null', AUDIT_MONGODB_URI: `mongodb://127.0.0.1:${port}/${database}?replicaSet=audit&directConnection=true`, AUTH_TOKEN_SECRET: 'isolated-transaction-audit-secret-123456789', ADMIN_EMAIL: 'audit@example.test', ADMIN_PASSWORD: 'Audit-only-123!', AUDIT_REPORT_PATH: join(out, 'report.json') };
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/review-transactions.mts'], { env, stdio: 'inherit' });
  const code = await new Promise(resolve => child.on('exit', resolve));
  if (code !== 0) throw new Error(`Falló la prueba transaccional: ${code}`);
  console.log(JSON.stringify({ ok: true, artifacts: out }));
} catch (error) {
  await writeFile(join(out, 'failure.txt'), error.stack);
  if (started) {
    const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8', timeout: 10000 });
    await writeFile(join(out, 'mongo.log'), (logs.stdout || '') + (logs.stderr || ''));
  }
  console.error(error.message); console.error(out); process.exitCode = 1;
} finally {
  if (started) {
    // Only the uniquely named scratch container created above is removed.
    try { run(['stop', '--time', '5', name]); run(['rm', name]); }
    catch (error) { console.error(`Limpieza pendiente de ${name}: ${error.message}`); process.exitCode = 1; }
  }
}
