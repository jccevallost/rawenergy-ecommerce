// CU11: cancelación del cliente y bloqueo tras 3 seguidas, en Chrome sin interfaz. API en memoria con cuentas y
// correo simulado, build temporal, perfil nuevo y datos sintéticos. Uso: node scripts/review-cancel.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('.');
const out = await mkdtemp(join(tmpdir(), 'rawenergy-cancel-review-'));
const apiPort = 14891, uiPort = 14892, debugPort = 14893;
const api = `http://127.0.0.1:${apiPort}`, ui = `http://127.0.0.1:${uiPort}`;
const env = { PATH: process.env.PATH, NODE_ENV: 'development', DOTENV_CONFIG_PATH: '/dev/null', PORT: String(apiPort), CORS_ORIGINS: ui, PUBLIC_API_URL: api, AUTH_TOKEN_SECRET: 'isolated-cancel-review-secret-12345678901', ADMIN_EMAIL: 'review@example.com', ADMIN_PASSWORD: 'Review-only-123!', ADMIN_NAME: 'Revisión', VITE_GRAPHQL_URL: `${api}/graphql`, GRAPHQL_RATE_LIMIT_PER_MINUTE: '600', MAX_PENDING_ORDERS_PER_CUSTOMER: '20', CUSTOMER_ACCOUNTS: 'on', MAIL_MODE: 'simulated', STORE_URL: ui, EMAIL_DOMAIN_CHECK: 'off' };
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
  for (let i = 0; i < 4; i++) {
    const { createCheckoutOrder } = await gql('mutation($i:CheckoutInput!){createCheckoutOrder(input:$i){id orderNumber}}', { i: { idempotencyKey: crypto.randomUUID(), expectedTotal: totals.total, customer: { fullName: 'Ana Revisión', email, phone: `09${String(++serial).padStart(8, '0')}`, province: 'Pichincha', city: 'Quito', address: 'Calle de prueba 123', idNumber: cedula() }, items, shippingMethod: 'SERVIENTREGA_NATIONAL', paymentMethod: 'BANK_TRANSFER' } }, session.token);
    orders.push(createCheckoutOrder);
  }
  const setStatus = (order, status) => gql('mutation($id:ID!,$s:OrderStatus!){updateOrderStatus(id:$id,status:$s){status}}', { id: order.id, s: status }, admin);

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

  const panel = () => js('!!document.querySelector(".remove-confirm")');
  const confirmButton = 'document.querySelector(".remove-confirm .btn-danger")';
  const cancelOne = async (order, expectWarning) => {
    await go(`/mis-pedidos/${order.orderNumber}`);
    await has('Esperando tu transferencia');
    await clickText('button', 'Cancelar pedido');
    await waitFor(panel, 'Confirmación abierta');
    await waitFor(() => js('document.activeElement?.id==="cancel-title"'), 'Foco en la confirmación');
    assert.equal(await js(`${confirmButton}.disabled`), true, 'Sin respuesta sobre el comprobante no se puede cancelar');
    assert.equal(await js('document.body.innerText.includes("Sería tu tercera cancelación seguida")'), expectWarning, 'Aviso previo solo en la tercera');
    await js('[...document.querySelectorAll(".remove-confirm input[name=proof]")][1].click()');
    await has('la cancelación y la devolución del dinero las revisa nuestro equipo');
    assert.equal(await js(`${confirmButton}.disabled`), true, 'Con comprobante enviado no cancela directamente');
    await js('[...document.querySelectorAll(".remove-confirm input[name=proof]")][0].click()');
    await waitFor(() => js(`!${confirmButton}.disabled`), 'Cancelar habilitado');
    await click('.remove-confirm .btn-danger');
  };

  // 1. Primera y segunda cancelación: confirmación con consecuencias, pregunta del comprobante y resultado.
  await cancelOne(orders[0], false);
  await has('Pedido cancelado. Los productos volvieron al catálogo.');
  await waitFor(() => js('!document.querySelector(".remove-confirm") && ![...document.querySelectorAll("button")].some(b=>b.textContent==="Cancelar pedido")'), 'Sin botón tras cancelar');
  await has('Cancelaste el pedido');
  await shot('01-cancelado');
  await cancelOne(orders[1], false);
  await has('Pedido cancelado.');
  checks.push('Cancelación: foco en la confirmación, no se puede cancelar sin responder ni con comprobante enviado, resultado anunciado y botón retirado');

  // 2. Tercera: aviso previo; al confirmar, sesión cerrada y mensaje de bloqueo.
  await cancelOne(orders[2], true);
  await has('Tu cuenta quedó bloqueada por seguridad');
  await waitFor(() => js('localStorage.getItem("rawenergy-token")===null'), 'Sesión cerrada');
  await has('Entra a tu cuenta para ver esta sección');
  await shot('02-bloqueado');
  checks.push('Tercera cancelación: aviso previo, sesión cerrada y mensaje de bloqueo');

  // 3. Acceso y consulta pública rechazados con el mensaje neutral.
  await click('.status-page .btn-primary');
  await waitFor(() => js('!!document.querySelector("#auth-email")'), 'Diálogo de acceso');
  await js(`(()=>{const set=(s,v)=>{const e=document.querySelector(s);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));};set('#auth-email',${JSON.stringify(email)});set('#auth-password',${JSON.stringify(password)});})()`);
  await click('.auth-card .btn-block');
  await waitFor(() => js('document.querySelector("#auth-error")?.textContent.includes("Tu cuenta quedó bloqueada por seguridad")'), 'Login con mensaje de bloqueo');
  await go(`/pedido?numero=${orders[3].orderNumber}`);
  await waitFor(() => js('document.querySelectorAll(".track-form input").length===2'), 'Formulario de consulta');
  await js(`(()=>{const e=document.querySelectorAll(".track-form input")[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(email)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await js('document.querySelector(".track-form .btn-primary").click()');
  await has('Tu cuenta quedó bloqueada por seguridad');
  checks.push('Bloqueo: el acceso con la contraseña correcta y la consulta pública del pedido muestran el mensaje neutral');

  // 4. Desbloqueo manual del operador: vuelve a entrar.
  await gql('mutation($id:ID!){updateUserStatus(id:$id,status:ACTIVE){status}}', { id: session.user.id }, admin);
  const { login: back } = await gql('mutation($input:LoginInput!){login(input:$input){token}}', { input: { email, password } });
  assert(back.token, 'Entra tras el desbloqueo');
  checks.push('Desbloqueo manual desde el panel: el cliente vuelve a entrar');

  assert.deepEqual(exceptions, []);
  await writeFile(join(out, 'report.json'), JSON.stringify({ ok: true, checks, caveats: ['API en memoria, build local, Chrome sin interfaz y datos sintéticos; la visibilidad de la pestaña se simula'] }, null, 2));
  console.log(JSON.stringify({ ok: true, artifacts: out, checks }, null, 2));
} catch (error) {
  if (inspect) try { await writeFile(join(out, 'screen.txt'), await inspect()); } catch {}
  await writeFile(join(out, 'failure.log'), `${error.stack}\n${logs.join('').slice(-12000)}`); console.error(error.message); console.error(`Diagnóstico: ${out}`); process.exitCode = 1;
} finally { socket?.close(); for (const child of processes.reverse()) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); } }
