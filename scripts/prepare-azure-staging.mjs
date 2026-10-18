import { mkdtemp, mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// Solo prepara un artefacto. No lee .env, contacta MongoDB ni despliega recursos.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const linuxReady = process.argv.includes("--linux-ready");
// --perfil=cuentas prepara el piloto de la fase de cuentas (CU02); sin él, la copia general con cuentas apagadas.
const profileArg = process.argv.find(arg => arg.startsWith("--perfil="))?.slice("--perfil=".length);
// --perfil=produccion: API de producción (AZURE-PROD-01); arranca con azure-start.mjs.
const profile = !profileArg ? "azure-staging" : profileArg === "cuentas" ? "azure-staging-cuentas" : profileArg === "produccion" ? "azure-produccion" : null;
if (!profile) throw new Error(`Perfil desconocido: ${profileArg}. Usa --perfil=cuentas, --perfil=produccion o ninguno.`);
const production = profile === "azure-produccion";
const startFile = production ? "azure-start.mjs" : "staging-start.mjs";
const linuxImage = "node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392";
const target = await mkdtemp(join(tmpdir(), "rawenergy-azure-stage-"));
const payload = join(target, "payload");
await mkdir(payload);
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} terminó con código ${result.status}`);
};
const api = JSON.parse(await readFile(join(root, "apps/api/package.json"), "utf8"));
const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const dependencies = Object.fromEntries(Object.keys(api.dependencies).map(name => {
  const version = lock.packages?.[`node_modules/${name}`]?.version
    ?? lock.packages?.[`apps/api/node_modules/${name}`]?.version;
  if (!version) throw new Error(`No hay versión bloqueada para ${name}`);
  return [name, version];
}));
const configPath = join(target, "tsconfig.json");
await writeFile(configPath, JSON.stringify({
  extends: join(root, "apps/api/tsconfig.json"),
  compilerOptions: { outDir: join(payload, "dist"), typeRoots: [join(root, "node_modules/@types")], incremental: false, sourceMap: false },
  include: [join(root, "apps/api/src/**/*.ts")],
  exclude: [join(root, "apps/api/src/**/*.test.ts"), join(root, "apps/api/src/**/fixtures/**")],
}, null, 2));
run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", configPath]);
const manifest = {
  name: production ? "rawenergy-api-azure" : "rawenergy-api-azure-staging", version: api.version, private: true, type: "module",
  engines: { node: ">=22.15 <23" },
  scripts: { start: `node ${startFile}` }, dependencies,
};
await writeFile(join(payload, "package.json"), JSON.stringify(manifest, null, 2));
// Partir del lock probado evita actualizar transitivas al separar el monorepo.
const packages = Object.fromEntries(Object.entries(lock.packages).filter(([path, entry]) => path.startsWith("node_modules/") && !entry.link));
for (const [path, entry] of Object.entries(lock.packages)) {
  if (path.startsWith("apps/api/node_modules/")) packages[path.slice("apps/api/".length)] = entry;
}
packages[""] = { name: manifest.name, version: manifest.version, dependencies, engines: manifest.engines };
await writeFile(join(payload, "package-lock.json"), JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages }, null, 2));

// Guardas específicas de este despliegue; no cambian server.ts ni la API de Render.
// El perfil queda fijado en el artefacto: uno construido para un perfil no arranca con otro.
await writeFile(join(payload, "staging-guards.mjs"), await readFile(join(root, "scripts/staging-guards.mjs"), "utf8"));
const startup = `import mongoose from "mongoose";
import { stagingProblems } from "./staging-guards.mjs";
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 22 || minor < 15) throw new Error("Staging requiere Node 22.15 o posterior de la rama 22");
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("Falta la conexión de la base de prueba");
// Comprobar la base que interpreta el controlador, incluidos parámetros dbName.
const client = new mongoose.mongo.MongoClient(uri);
const database = client.db().databaseName;
const problems = stagingProblems(${JSON.stringify(profile)}, process.env, database);
if (problems.length) throw new Error(problems.join("; "));
console.info(${JSON.stringify(production ? `[azure] Perfil ${profile}: base de producción confirmada` : `[staging] Perfil ${profile}: base dedicada y canales externos desactivados`)});
await import("./dist/server.js");
`;
await writeFile(join(payload, startFile), startup);
// Node y dependencias nativas se instalan en Azure/Linux, nunca se copian desde macOS.
console.info(`Artefacto preparado en ${payload}`);
console.info("Fijando dependencias transitivas; no se instalan módulos ni scripts.");
run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", ...(!process.argv.includes("--online") ? ["--offline"] : [])], payload);
await writeFile(join(payload, ".deployment"), `[config]\nSCM_DO_BUILD_DURING_DEPLOYMENT=${!linuxReady}\n`);
const files = [];
async function collect(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const full = join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error("No se permiten enlaces simbólicos en el artefacto");
    if (entry.isDirectory()) await collect(full);
    else files.push(relative(payload, full));
  }
}
await collect(payload);
if (files.some(path => /(^|\/)(\.env(?:\..*)?|node_modules|fixtures)(\/|$)|\.test\.|\.pdf$|\.respaldo$/i.test(path))) {
  throw new Error("Archivo no permitido en el artefacto");
}
if (linuxReady) {
  const dockerArgs = ["run", "--rm", "--platform", "linux/amd64", "--mount", `type=bind,source=${payload},target=/work`, "--workdir", "/work", linuxImage];
  run("docker", [...dockerArgs, "npm", "ci", "--omit=dev", "--no-audit", "--no-fund"]);
  // pdfjs-dist solo se comprueba si el paquete lo incluye (las versiones anteriores a IMP-01 no lo usan).
  const pdfCheck = dependencies["pdfjs-dist"] ? 'await import("pdfjs-dist/legacy/build/pdf.mjs");' : "";
  run("docker", [...dockerArgs, "node", "--input-type=module", "-e", `import sharp from "sharp"; import mongoose from "mongoose"; ${pdfCheck} const bytes = await sharp({create:{width:2,height:2,channels:3,background:"white"}}).webp().toBuffer(); if(!bytes.length) throw new Error("Sharp no produce WebP"); console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,sharpWebp:true,mongoose:mongoose.version,pdfImport:${Boolean(pdfCheck)}}));`]);
}
const archive = join(target, production ? "rawenergy-api-produccion.zip" : "rawenergy-api-staging.zip");
run("zip", ["-q", "-r", archive, "."], payload);
const hash = createHash("sha256").update(await readFile(archive)).digest("hex");
const report = { archive, payload, profile, applicationFiles: files.length, linuxReady, ...(linuxReady ? { linuxImage } : {}), bytes: (await stat(archive)).size, sha256: hash, preparedAt: new Date().toISOString(), buildHostNode: process.version };
await writeFile(join(target, "report.json"), JSON.stringify(report, null, 2));
console.info(JSON.stringify(report, null, 2));
