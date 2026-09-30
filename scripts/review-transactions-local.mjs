// P01 sin Docker: réplica temporal de MongoDB con el binario oficial (mongodb-memory-server)
// y el guion scripts/review-transactions.mts. La base y la réplica se eliminan al terminar.
// Requiere, una sola vez: npm i --no-save mongodb-memory-server@11   (no modifica package.json)
// Uso: node scripts/review-transactions-local.mjs [guion .mts]   (por omisión scripts/review-transactions.mts;
//      scripts/review-price-range.mts verifica el precio «desde» de P08)
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let MongoMemoryReplSet;
try { ({ MongoMemoryReplSet } = await import("mongodb-memory-server")); }
catch { console.error("Falta mongodb-memory-server. Instálalo sin guardarlo: npm i --no-save mongodb-memory-server@11"); process.exit(1); }

const script = process.argv[2] ?? "scripts/review-transactions.mts";
const out = await mkdtemp(join(tmpdir(), "rawenergy-transactions-real-"));
const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, name: "audit", storageEngine: "wiredTiger" } });
try {
  const database = `rawenergy_audit_${randomUUID().replaceAll("-", "")}`;
  const uri = `mongodb://127.0.0.1:${replSet.servers[0].instanceInfo.port}/${database}?replicaSet=audit&directConnection=true`;
  const env = { PATH: process.env.PATH, NODE_ENV: "test", DOTENV_CONFIG_PATH: "/dev/null", AUDIT_MONGODB_URI: uri, AUTH_TOKEN_SECRET: "isolated-transaction-audit-secret-123456789", ADMIN_EMAIL: "audit@example.test", ADMIN_PASSWORD: "Audit-only-123!", AUDIT_REPORT_PATH: join(out, "report.json") };
  const child = spawn(process.execPath, ["--import", "tsx", script], { env, stdio: "inherit" });
  const code = await new Promise(resolve => child.on("exit", resolve));
  console.log(JSON.stringify({ ok: code === 0, report: join(out, "report.json") }));
  process.exitCode = code === 0 ? 0 : 1;
} finally { await replSet.stop({ doCleanup: true, force: true }); }
