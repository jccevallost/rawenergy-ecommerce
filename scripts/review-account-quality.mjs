// CU13: accesibilidad y rendimiento de las vistas de cuenta en Chrome sin interfaz. API en memoria con cuentas y
// correo simulado, build de producción local, datos sintéticos. Uso: node scripts/review-account-quality.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('.');
const out = await mkdtemp(join(tmpdir(), 'rawenergy-quality-review-'));
const apiPort = 14921, uiPort = 14922, debugPort = 14923;
const api = `http://127.0.0.1:${apiPort}`, ui = `http://127.0.0.1:${uiPort}`;
const env = { PATH: process.env.PATH, NODE_ENV: 'development', DOTENV_CONFIG_PATH: '/dev/null', PORT: String(apiPort), CORS_ORIGINS: ui, PUBLIC_API_URL: api, AUTH_TOKEN_SECRET: 'isolated-quality-review-secret-1234567890', ADMIN_EMAIL: 'review@example.com', ADMIN_PASSWORD: 'Review-only-123!', ADMIN_NAME: 'Revisión', VITE_GRAPHQL_URL: `${api}/graphql`, GRAPHQL_RATE_LIMIT_PER_MINUTE: '600', MAX_PENDING_ORDERS_PER_CUSTOMER: '20', CUSTOMER_ACCOUNTS: 'on', MAIL_MODE: 'simulated', STORE_URL: ui, EMAIL_DOMAIN_CHECK: 'off' };
const processes = [], logs = [], exceptions = [], checks = [];
let socket, inspect;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const launch = (command, args, options = {}) => {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...options });
  processes.push(child); child.stdout.on('data', data => logs.push(String(data))); child.stderr.on('data', data => logs.push(String(data))); child.on('error', error => logs.push(error.message)); return child;
};
async function waitFor(fn, label, tries = 120) { let last; for (let i = 0; i < tries; i++) { try { const value = await fn(); if (value) return value; } catch (error) { last = error; } await delay(150); } throw new Error(`No se cumplió: ${label}${last ? ` (${last.message})` : ''}`); }
async function gql(query, variables = {}, token = '') { const response = await fetch(`${api}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) }); const body = await response.json(); if (body.errors) throw new Error(body.errors[0].message); return body.data; }
let serial = 820000;
const cedula = () => { const base = `17${String(++serial).padStart(7, '0')}`; const sum = base.split('').map(Number).reduce((s, v, i) => { let x = i % 2 === 0 ? v * 2 : v; if (x > 9) x -= 9; return s + x; }, 0); return base + ((10 - (sum % 10)) % 10); };
try {
  for (const port of [apiPort, uiPort, debugPort]) { let occupied = false; try { await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) }); occupied = true; } catch {} assert(!occupied, `Puerto ocupado: ${port}`); }
  const build = launch(process.execPath, ['node_modules/vite/bin/vite.js', 'build', 'apps/web', '--outDir', join(out, 'dist')], { env: { ...env, NODE_ENV: 'production' } });
  assert.equal(await new Promise(resolve => build.on('exit', resolve)), 0, 'Build temporal');
  launch(process.execPath, ['--import', 'tsx', 'apps/api/src/server.ts']);
  launch(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', 'apps/web', '--outDir', join(out, 'dist'), '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort']);
  await waitFor(async () => (await fetch(`${api}/health`)).ok, 'API'); await waitFor(async () => (await fetch(ui)).ok, 'Tienda');
  const { login: { token: admin } } = await gql('mutation($input:LoginInput!){login(input:$input){token}}', { input: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } });
  const sku = `REV-PEDIDOS-${Date.now()}`;
  const { upsertProduct: product } = await gql('mutation($payload:JSON!){upsertProduct(payload:$payload){id}}', { payload: { title: 'Proteína de revisión', brand: 'Marca de revisión', slug: `pedidos-revision-${Date.now()}`, shortDescription: 'Producto sintético para revisar Mis pedidos.', productType: 'SUPPLEMENT', nutritionalFacts: { servingSize: '30 g', calories: 100, protein: 20, carbohydrates: 3, fats: 1 }, categories: [{ name: 'Prueba', slug: 'prueba' }], goals: [{ name: 'Desarrollo muscular', slug: 'desarrollo-muscular' }], featured: false, variants: [{ sku, flavor: 'Vainilla', size: { value: 1, unit: 'kg' }, price: 30, stock: 80, images: [{ url: '/assets/brands/raw-nutrition.png', alt: 'Foto de prueba' }] }] } }, admin);

  const email = `pedidos-${Date.now()}@example.test`, password = 'Cuenta-revision-2026';
  await gql('mutation($i:RegisterInput!){register(input:$i){accepted}}', { i: { name: 'Ana Revisión', email, password } });
  const mail = await waitFor(async () => (await gql('query($to:String){simulatedMailbox(to:$to)}', { to: email }, admin)).simulatedMailbox[0], 'Correo de confirmación');
  await gql('mutation($t:String!){verifyEmail(token:$t)}', { t: decodeURIComponent(/#verificar=([^"&]+)/.exec(mail.html)[1]) });
  const { login: session } = await gql('mutation($input:LoginInput!){login(input:$input){token user{id name email role status emailVerified}}}', { input: { email, password } });
  const items = [{ productId: product.id, variantSku: sku, quantity: 1 }];
  const { calculateCartTotals: totals } = await gql('query($c:[CartItemInput!]!){calculateCartTotals(cartItems:$c, shippingMethod:SERVIENTREGA_NATIONAL){total}}', { c: items });
  const orders = [];
  for (let i = 0; i < 12; i++) {
    const { createCheckoutOrder } = await gql('mutation($i:CheckoutInput!){createCheckoutOrder(input:$i){id orderNumber}}', { i: { idempotencyKey: crypto.randomUUID(), expectedTotal: totals.total, customer: { fullName: 'Ana Revisión', email, phone: `09${String(++serial).padStart(8, '0')}`, province: 'Pichincha', city: 'Quito', address: 'Calle de prueba 123', idNumber: cedula() }, items, shippingMethod: 'SERVIENTREGA_NATIONAL', paymentMethod: 'BANK_TRANSFER' } }, session.token);
    orders.push(createCheckoutOrder);
  }
  const setStatus = (order, status) => gql('mutation($id:ID!,$s:OrderStatus!){updateOrderStatus(id:$id,status:$s){status}}', { id: order.id, s: status }, admin);
  await setStatus(orders[0], 'CANCELLED');
  // Perfil completo para las vistas de cuenta y el checkout con datos guardados.
  let { myProfile: profile } = await gql('{myProfile{revision}}', {}, session.token);
  profile = (await gql('mutation($i:CustomerContactInput!,$r:Int!){updateMyContact(input:$i,revision:$r){revision}}', { i: { name: 'Ana Revisión', phone: '0991234567' }, r: profile.revision }, session.token)).updateMyContact;
  profile = (await gql('mutation($i:CustomerBillingInput,$r:Int!){updateMyBilling(input:$i,revision:$r){revision}}', { i: { name: 'Ana Revisión', idNumber: '0926687856' }, r: profile.revision }, session.token)).updateMyBilling;
  for (const label of ['Casa', 'Oficina']) profile = (await gql('mutation($i:CustomerAddressInput!,$r:Int!){addMyAddress(input:$i,revision:$r){profile{revision}}}', { i: { label, province: 'Pichincha', city: 'Quito', address: `Av. Amazonas N24-${label === 'Casa' ? '100' : '200'} y Colón`, reference: 'Edificio de prueba con una referencia larga para revisar el ajuste de línea' }, r: profile.revision }, session.token)).addMyAddress.profile;

  launch(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(out, 'chrome')}`, 'about:blank']);
  const tabs = await waitFor(async () => { const items = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); return items.length && items; }, 'Chrome');
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let serialId = 0;
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); } if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text); });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serialId; const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method}`)); }, 20000); pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
  const js = async expression => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'JS error'); return result.result.value; };
  const click = selector => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('No existe '+${JSON.stringify(selector)});e.focus();e.click();return true})()`);
  const clickText = (selector, text) => js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.trim().startsWith(${JSON.stringify(text)}));if(!e)throw new Error('No existe '+${JSON.stringify(text)});e.focus();e.click();return true})()`);
  const has = text => waitFor(() => js(`document.body.innerText.includes(${JSON.stringify(text)})`), text);
  const shot = async name => { await delay(200); const result = await cdp('Page.captureScreenshot', { format: 'png' }); await writeFile(join(out, `${name}.png`), Buffer.from(result.data, 'base64')); };
  const go = async path => { await cdp('Page.navigate', { url: `${ui}${path}` }); await waitFor(() => js('document.readyState==="complete"'), path); };
  const orderRequests = () => js('performance.getEntriesByType("resource").filter(r=>r.name.includes("/graphql")).length');
  const cards = () => js('document.querySelectorAll(".customer-orders > li").length');
  const unnamed = async label => { const tree = await cdp('Accessibility.getFullAXTree'); const bad = tree.nodes.filter(n => !n.ignored && ['button', 'link', 'textbox'].includes(n.role?.value) && !n.name?.value?.trim()); assert.equal(bad.length, 0, `Controles sin nombre: ${label}`); };
  inspect = async () => { await shot('failure'); return js('location.href+"\\n"+document.body.innerText.slice(0,2500)'); };
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable'); await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp('Network.setBlockedURLs', { urls: ['https://*'] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await go('/');
  await js(`localStorage.setItem("rawenergy-token", ${JSON.stringify(session.token)}); localStorage.setItem("rawenergy-user", ${JSON.stringify(JSON.stringify(session.user))})`);

  const pages = ['/cuenta', '/cuenta/direcciones', '/cuenta/seguridad', '/mis-pedidos', `/mis-pedidos/${orders[1].orderNumber}`];
  const ready = () => waitFor(() => js('!!document.querySelector(".account-card, .customer-orders li, .order-detail")'), 'Vista cargada');
  const overflow = () => js('document.documentElement.scrollWidth - innerWidth');
  await go('/');
  await js(`localStorage.setItem("rawenergy-token", ${JSON.stringify(session.token)}); localStorage.setItem("rawenergy-user", ${JSON.stringify(JSON.stringify(session.user))})`);

  // 1. Reflujo: 320 px (zoom 400 % de 1280), horizontal 640×360 y espaciado de texto WCAG 1.4.12.
  const results = [];
  for (const [label, width, height] of [['320 px', 320, 640], ['horizontal', 640, 360], ['1280 px', 1280, 900]]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 900 });
    for (const path of pages) { await go(path); await ready(); results.push([label, path, await overflow()]); }
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
  for (const path of pages) {
    await go(path); await ready();
    await js('(()=>{const s=document.createElement("style");s.textContent="*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}";document.head.append(s);})()');
    await delay(100);
    results.push(['espaciado de texto a 320 px', path, await overflow()]);
  }
  const overflowing = results.filter(([, , value]) => value > 0);
  assert.deepEqual(overflowing, [], `Desbordamiento horizontal: ${JSON.stringify(overflowing)}`);
  await shot('01-direcciones-320-espaciado');
  checks.push(`Reflujo sin desbordamiento horizontal en ${results.length} combinaciones (320 px, horizontal 640×360, 1280 px y espaciado de texto a 320 px) de 5 vistas`);

  // 2. Nombres accesibles, un h1 y foco visible con teclado en cada vista.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const path of pages) {
    await go(path); await ready();
    await unnamed(path);
    assert.equal(await js('document.querySelectorAll("h1").length'), 1, `Un h1: ${path}`);
    // Recorre con Tab los primeros 25 controles: todos reciben foco y muestran un indicador visible.
    const invisible = [];
    await js('document.body.focus()');
    for (let i = 0; i < 25; i++) {
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      const info = await js('(()=>{const e=document.activeElement;if(!e||e===document.body)return null;const shown=[e,e.parentElement,e.parentElement?.parentElement].filter(Boolean).some(n=>{const c=getComputedStyle(n);return (c.outlineStyle!=="none"&&parseFloat(c.outlineWidth)>0)||c.boxShadow!=="none"});return {tag:e.tagName,text:(e.getAttribute("aria-label")||e.textContent||"").trim().slice(0,30),outline:shown,shadow:shown}})()');
      if (info && !info.outline && !info.shadow) invisible.push(info);
    }
    assert.deepEqual(invisible, [], `Foco sin indicador visible en ${path}: ${JSON.stringify(invisible)}`);
  }
  checks.push('Cada vista: sin controles sin nombre, un h1 y foco visible en los primeros 25 controles con Tab');

  // 3. Movimiento reducido: las transiciones nuevas quedan anuladas.
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await go('/cuenta'); await ready();
  assert(await js('parseFloat(getComputedStyle(document.querySelector(".account-menu-chevron")).transitionDuration) < 0.01'), 'Sin transición con movimiento reducido');
  await cdp('Emulation.setEmulatedMedia', { features: [] });
  checks.push('Movimiento reducido: la animación del menú de cuenta queda anulada');

  // 4. Rendimiento local con red lenta emulada (no certifica producción).
  await cdp('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  await cdp('Network.setCacheDisabled', { cacheDisabled: true });
  const timings = [];
  for (const path of ['/mis-pedidos', `/mis-pedidos/${orders[1].orderNumber}`, '/cuenta/direcciones']) {
    const start = Date.now(); await cdp('Page.navigate', { url: `${ui}${path}` }); await ready(); timings.push([path, Date.now() - start]);
  }
  await cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp('Network.setCacheDisabled', { cacheDisabled: false });
  const apiTiming = async (query, variables = {}) => { const samples = []; for (let i = 0; i < 20; i++) { const start = performance.now(); await gql(query, variables, session.token); samples.push(performance.now() - start); } samples.sort((a, b) => a - b); return { median: Math.round(samples[10] * 10) / 10, p95: Math.round(samples[18] * 10) / 10 }; };
  const apiTimes = { myOrdersPage: await apiTiming('{myOrdersPage(first:10){orders{orderNumber}}}'), myOrder: await apiTiming('query($n:String!){myOrder(number:$n){orderNumber}}', { n: orders[1].orderNumber }), myProfile: await apiTiming('{myProfile{revision}}') };
  checks.push(`Rendimiento (local, red emulada 150 ms / 1,6 Mbps, caché desactivada): ${timings.map(([p, ms]) => `${p} ${ms} ms`).join('; ')}. API en memoria, 20 llamadas: ${Object.entries(apiTimes).map(([k, v]) => `${k} mediana ${v.median} ms, p95 ${v.p95} ms`).join('; ')}`);

  assert.deepEqual(exceptions, []);
  await writeFile(join(out, 'report.json'), JSON.stringify({ ok: true, checks, caveats: ['API en memoria, build local, Chrome sin interfaz y datos sintéticos; la visibilidad de la pestaña se simula'] }, null, 2));
  console.log(JSON.stringify({ ok: true, artifacts: out, checks }, null, 2));
} catch (error) {
  if (inspect) try { await writeFile(join(out, 'screen.txt'), await inspect()); } catch {}
  await writeFile(join(out, 'failure.log'), `${error.stack}\n${logs.join('').slice(-12000)}`); console.error(error.message); console.error(`Diagnóstico: ${out}`); process.exitCode = 1;
} finally { socket?.close(); for (const child of processes.reverse()) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); } }
