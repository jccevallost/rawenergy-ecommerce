// SEG-01: recorrido aislado del panel con el segundo factor obligatorio. Datos en memoria, sin .env,
// perfil temporal de Chrome. Uso desde la raíz: node --import tsx scripts/review-staff-mfa-ui.mts
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { currentStep, totpCode } from "../apps/api/src/lib/totp.ts";

const root = resolve("."); const out = await mkdtemp(join(tmpdir(), "rawenergy-mfa-ui-"));
const apiPort = 14861, uiPort = 14862, debugPort = 14863;
const api = `http://127.0.0.1:${apiPort}`, ui = `http://127.0.0.1:${uiPort}`;
const env: Record<string, string> = { PATH: process.env.PATH ?? "", NODE_ENV: "development", DOTENV_CONFIG_PATH: "/dev/null", PORT: String(apiPort), PUBLIC_API_URL: api, STAFF_MFA: "required", AUTH_TOKEN_SECRET: "isolated-mfa-review-secret-123456789012", ADMIN_EMAIL: "mfa@example.com", ADMIN_PASSWORD: "Review-only-123!", ADMIN_NAME: "Dueño de prueba", VITE_GRAPHQL_URL: `${api}/graphql`, VITE_WEB_URL: "http://localhost:5173" };
const processes: ChildProcess[] = []; const logs: string[] = []; let socket: WebSocket | undefined; let inspect: (() => Promise<string>) | undefined;
const launch = (command: string, args: string[], extra: Record<string, unknown> = {}) => { const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], ...extra }); processes.push(child); child.stdout?.on("data", d => logs.push(String(d))); child.stderr?.on("data", d => logs.push(String(d))); return child; };
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T>, label: string): Promise<T> { let last: unknown; for (let i = 0; i < 100; i++) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await delay(150); } throw new Error(`Timeout: ${label}${last ? ` (${(last as Error).message})` : ""}`); }
const checks: string[] = []; const ok = (t: string) => { checks.push(t); console.log(`✓ ${t}`); };
try {
  launch(process.execPath, ["--import", "tsx", "apps/api/src/server.ts"]);
  launch(process.execPath, ["node_modules/vite/bin/vite.js", "apps/admin", "--host", "127.0.0.1", "--port", String(uiPort), "--strictPort"]);
  await waitFor(async () => (await fetch(`${api}/health`)).ok, "API"); await waitFor(async () => (await fetch(ui)).ok, "Panel");
  const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  launch(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(out, "profile")}`, "--window-size=1280,900", "about:blank"], { env: { ...env, HOME: process.env.HOME } });
  const tabs = await waitFor(async () => { const t = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json() as Array<{ type: string; webSocketDebuggerUrl: string }>; return t.length ? t : null; }, "Chrome");
  socket = new WebSocket(tabs!.find(t => t.type === "page")!.webSocketDebuggerUrl);
  await new Promise((r, j) => { socket!.addEventListener("open", r, { once: true }); socket!.addEventListener("error", j, { once: true }); });
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>(); let serial = 0; const exceptions: string[] = [];
  socket.addEventListener("message", e => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { const t = pending.get(m.id)!; pending.delete(m.id); m.error ? t.reject(new Error(m.error.message)) : t.resolve(m.result); } if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
  const cdp = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); socket!.send(JSON.stringify({ id, method, params })); });
  const js = async (expression: string) => { const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "JS"); return r.result.value; };
  const click = (text: string) => js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&b.getClientRects().length);if(!b)throw new Error(${JSON.stringify("No encontrado: " + text)});b.click();return true;})()`);
  const fill = (selector: string, value: string) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  const has = (text: string) => waitFor(() => js(`document.body.innerText.includes(${JSON.stringify(text)})`), text);
  const shot = async (name: string) => { await delay(250); const r = await cdp("Page.captureScreenshot", { format: "png" }); await writeFile(join(out, `${name}.png`), Buffer.from(r.data, "base64")); };
  inspect = async () => { await shot("failure"); return js("document.body.innerText"); };
  await cdp("Runtime.enable"); await cdp("Page.enable");
  await cdp("Page.navigate", { url: ui }); await has("Iniciar sesión");
  await fill("input[type=email]", env.ADMIN_EMAIL!); await fill("input[type=password]", env.ADMIN_PASSWORD!); await click("Entrar al panel");
  await has("Activa la verificación en dos pasos"); await shot("01-activacion-obligatoria");
  assert.equal(await js(`!!document.querySelector('.sidebar')`), false);
  ok("Sin segundo factor, el panel muestra solo la pantalla de activación");
  const blocked = await (await fetch(`${api}/graphql`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await js("localStorage.getItem('rawenergy-token')")}` }, body: JSON.stringify({ query: "{ supplyOverview }" }) })).json() as { errors?: Array<{ extensions?: { code?: string } }> };
  assert.equal(blocked.errors?.[0]?.extensions?.code, "MFA_SETUP_REQUIRED");
  ok("La API rechaza las consultas del panel con esa sesión hasta activar el segundo factor");
  await click("Activar verificación en dos pasos");
  const secret = await waitFor(() => js(`(()=>{const e=[...document.querySelectorAll('code,kbd,strong,b,p,span')].find(e=>/^[A-Z2-7]{4}( [A-Z2-7]{1,4}){3,}$/.test(e.textContent.trim()));return e?e.textContent.replace(/\\s/g,''):'';})()`), "secreto visible") as string;
  await fill("#two-factor-code", totpCode(secret, currentStep()));
  await click("Confirmar y activar"); await has("Copiar códigos"); await shot("02-codigos-recuperacion");
  ok("Se activa con un código de la app y los códigos de recuperación quedan en pantalla");
  await click("Continuar al panel"); await has("Buen día");
  assert.equal(await js(`!!document.querySelector('.sidebar')`), true);
  ok("Al pulsar «Continuar al panel» se abre el panel completo");
  assert.deepEqual(exceptions, []);
  await writeFile(join(out, "report.json"), JSON.stringify({ ok: true, checks }, null, 2));
  console.log(JSON.stringify({ ok: true, artifacts: out, checks: checks.length }));
} catch (error) { if (inspect) try { await writeFile(join(out, "screen.txt"), await inspect()); } catch {} console.error((error as Error).message); await writeFile(join(out, "failure.log"), `${(error as Error).stack}\n\n${logs.join("").slice(-12000)}`); console.error(`Diagnóstico: ${out}`); process.exitCode = 1; }
finally { socket?.close(); for (const child of processes.reverse()) child.kill("SIGTERM"); }
