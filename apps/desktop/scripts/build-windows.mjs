// WIN-01: compila el instalador de Windows (.exe NSIS) desde macOS o Linux con cargo-xwin, o en Windows.
// Uso: npm run build:windows -w @vital-forge/desktop   (RAWENERGY_PANEL_URL cambia el panel; por omisión, producción)
// Requisitos fuera de Windows: rustup con el destino x86_64-pc-windows-msvc, cargo-xwin, llvm y makensis.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const panelUrl = process.env.RAWENERGY_PANEL_URL ?? "https://icy-meadow-0e332cb10.1.azurestaticapps.net";
if (!/^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(panelUrl)) throw new Error("RAWENERGY_PANEL_URL debe ser una dirección https sin ruta.");
const template = readFileSync(join(root, "src-tauri/windows/installer.template.nsi"), "utf8");
writeFileSync(join(root, "src-tauri/windows/installer.nsi"), template.replaceAll("@@PANEL_URL@@", panelUrl));
const onWindows = process.platform === "win32";
const extraPath = onWindows ? [] : ["/opt/homebrew/opt/llvm/bin", "/opt/homebrew/opt/rustup/bin", `${process.env.HOME}/.cargo/bin`];
const env = { ...process.env, RAWENERGY_PANEL_URL: panelUrl, PATH: [...extraPath, process.env.PATH].join(onWindows ? ";" : ":") };
const args = ["tauri", "build", "--bundles", "nsis", ...(onWindows ? [] : ["--runner", "cargo-xwin", "--target", "x86_64-pc-windows-msvc"])];
const result = spawnSync("npx", args, { cwd: root, env, stdio: "inherit", shell: onWindows });
process.exit(result.status ?? 1);
