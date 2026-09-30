// Pruebas locales con un solo comando: API, tienda y panel.
//   npm run demo                → aislado: datos en memoria, sin correo ni Telegram, no lee .env
//   npm run demo -- --red       → además, accesible desde el celular en la misma red Wi-Fi
//   npm run demo -- --con-env   → usa apps/api/.env (MongoDB, correo y Telegram reales)
//   npm run demo -- --sin-abrir → no abre el navegador
// Guía: docs/pruebas-locales.md
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const options = ['--red', '--con-env', '--sin-abrir', '--ayuda'];
const args = new Set(process.argv.slice(2));
const unknown = [...args].filter(arg => !options.includes(arg));
if (args.has('--ayuda') || unknown.length) {
  if (unknown.length) console.error(`Opción desconocida: ${unknown.join(', ')}\n`);
  console.log('Uso: npm run demo [-- --red] [-- --con-env] [-- --sin-abrir]\nGuía completa: docs/pruebas-locales.md');
  process.exit(unknown.length ? 1 : 0);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const withEnv = args.has('--con-env');
const ports = { api: 4000, web: 5173, admin: 5174 };
const lan = args.has('--red') ? Object.values(networkInterfaces()).flat().find(item => item?.family === 'IPv4' && !item.internal)?.address : null;
if (args.has('--red') && !lan) { console.error('No encontré una red local. Conéctate al Wi-Fi o quita --red.'); process.exit(1); }
const host = lan ?? 'localhost';
const url = { api: `http://${host}:${ports.api}`, web: `http://${host}:${ports.web}`, admin: `http://${host}:${ports.admin}` };
const demoAdmin = { email: 'admin@demo.local', password: 'Demo-RawEnergy-2026' };

if (!existsSync(join(root, 'node_modules', 'vite', 'bin', 'vite.js'))) { console.error('Faltan dependencias. Ejecuta primero: npm install'); process.exit(1); }
if (withEnv && !existsSync(join(root, 'apps', 'api', '.env'))) { console.error('--con-env necesita apps/api/.env (copia apps/api/.env.example).'); process.exit(1); }
const isFree = port => new Promise(resolve => { const probe = createServer().once('error', () => resolve(false)).once('listening', () => probe.close(() => resolve(true))).listen(port); });
for (const [name, port] of Object.entries(ports)) {
  if (!await isFree(port)) { console.error(`El puerto ${port} (${name}) está ocupado. Cierra la otra copia de la tienda (npm run dev o npm run demo) y vuelve a intentarlo.`); process.exit(1); }
}

// Modo aislado: solo PATH/HOME del sistema, para que ninguna variable del shell
// (MONGODB_URI, SMTP, Telegram) escape a la demo.
const base = { PATH: process.env.PATH, HOME: process.env.HOME, SystemRoot: process.env.SystemRoot, NODE_ENV: 'development' };
const apiEnv = withEnv
  ? { ...process.env, NODE_ENV: 'development', PORT: String(ports.api), PUBLIC_API_URL: url.api, ADMIN_APP_URL: url.admin }
  : { ...base, DOTENV_CONFIG_PATH: join(root, 'scripts', '.demo-sin-env'), PORT: String(ports.api), PUBLIC_API_URL: url.api, ADMIN_APP_URL: url.admin,
      AUTH_TOKEN_SECRET: randomBytes(32).toString('hex'), ADMIN_EMAIL: demoAdmin.email, ADMIN_PASSWORD: demoAdmin.password, ADMIN_NAME: 'Administración (demo)',
      STORE_NAME: 'RawEnergy EC', STORE_WHATSAPP: '593983368127' };
const viteEnv = { ...base, VITE_GRAPHQL_URL: `${url.api}/graphql`, VITE_ADMIN_URL: url.admin, VITE_WEB_URL: url.web };

const children = [];
const start = (label, command, commandArgs, options) => {
  const child = spawn(command, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', ...options });
  children.push(child);
  const relay = data => { for (const line of String(data).split('\n')) if (line.trim()) console.log(`[${label}] ${line}`); };
  child.stdout.on('data', relay); child.stderr.on('data', relay);
  child.on('exit', code => { if (!stopping) { console.error(`\n[${label}] se detuvo (código ${code}). Cerrando la demo.`); stop(1); } });
  return child;
};
let stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true;
  for (const child of children) { try { process.platform === 'win32' ? child.kill() : process.kill(-child.pid, 'SIGTERM'); } catch { /* ya terminó */ } }
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));

const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const exposed = lan ? ['--host', '0.0.0.0'] : [];
start('api', process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: join(root, 'apps', 'api'), env: apiEnv });
start('tienda', process.execPath, [vite, 'apps/web', '--port', String(ports.web), '--strictPort', ...exposed], { cwd: root, env: viteEnv });
start('panel', process.execPath, [vite, 'apps/admin', '--port', String(ports.admin), '--strictPort', ...exposed], { cwd: root, env: viteEnv });

// localhost y no 127.0.0.1: Vite escucha en ::1 en macOS salvo con --red.
const local = { api: `http://localhost:${ports.api}/health`, web: `http://localhost:${ports.web}`, admin: `http://localhost:${ports.admin}` };
const deadline = Date.now() + 90_000;
for (const [name, target] of Object.entries(local)) {
  for (;;) {
    try { if ((await fetch(target, { signal: AbortSignal.timeout(1500) })).ok) break; } catch { /* aún arrancando */ }
    if (stopping) process.exit(1);
    if (Date.now() > deadline) { console.error(`${name} no respondió en 90 s. Revisa los mensajes de arriba.`); stop(1); await new Promise(() => {}); }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
}

console.log(`
──────────────────────────────────────────────
 RawEnergy listo para pruebas ${withEnv ? '(con apps/api/.env: datos, correo y avisos REALES)' : '(aislado: datos en memoria)'}
  Tienda  ${url.web}
  Panel   ${url.admin}
  API     ${url.api}/graphql
${withEnv ? '  Acceso al panel: el ADMIN_EMAIL y ADMIN_PASSWORD de apps/api/.env' : `  Acceso al panel: ${demoAdmin.email} / ${demoAdmin.password}
  Todo lo que crees se borra al cerrar. No se envían correos ni avisos de Telegram.`}
${lan ? '  Desde el celular: misma red Wi-Fi y las direcciones de arriba.\n' : ''}  Para cerrar: Ctrl + C
──────────────────────────────────────────────`);

if (!args.has('--sin-abrir')) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  for (const target of [url.web, url.admin]) spawn(opener, [target], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
