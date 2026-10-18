import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

// Reutiliza los artefactos aislados de AZURE-STORE-TEST-01; no compila ni cambia GitHub.
const report = JSON.parse(await readFile("/private/tmp/rawenergy-store-switch-current.json", "utf8"));
const rollback = process.argv.includes("--restore-render");
const directory = rollback ? join(report.directory, "rollback-render") : join(report.source, "apps/web/dist");
const endpoint = rollback ? report.previousBackend : report.testBackend;
const config = JSON.parse(await readFile(join(directory, "staticwebapp.config.json"), "utf8"));
if (!config.globalHeaders?.["Content-Security-Policy"]?.includes(new URL(endpoint).origin)) {
  throw new Error("La CSP del artefacto no corresponde al backend seleccionado");
}
const html = await readFile(join(directory, "index.html"), "utf8");
const entry = html.match(/src="(\/assets\/[^\"]+\.js)"/);
if (!entry || !(await readFile(join(directory, entry[1]), "utf8")).includes(endpoint)) {
  throw new Error("El JavaScript no contiene el endpoint esperado");
}
const cli = join(report.directory, "cli/node_modules/.bin/swa");
await access(cli);
const token = (await readFile("/private/tmp/rawenergy-azure-stage-private/store-deploy-token.txt", "utf8")).trim();
if (!token) throw new Error("Falta el acceso privado de publicación de la tienda");
console.info(`Publicando tienda con ${rollback ? "Render" : "Azure de prueba"}; el panel no cambia.`);
const child = spawn(cli, ["deploy", directory, "--swa-config-location", directory, "--env", "production", "--no-use-keychain"], {
  cwd: report.directory,
  env: { ...process.env, SWA_CLI_DEPLOYMENT_TOKEN: token, SWA_CLI_TELEMETRY_OPTOUT: "1" },
  stdio: "inherit",
});
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
