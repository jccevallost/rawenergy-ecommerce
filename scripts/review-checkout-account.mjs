// CU08: checkout con datos guardados en Chrome sin interfaz. API en memoria con cuentas y correo simulado, build
// temporal y perfil nuevo; datos sintéticos. Uso: node scripts/review-checkout-account.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('.');
const out = await mkdtemp(join(tmpdir(), 'rawenergy-checkout-account-'));
const apiPort = 14871, uiPort = 14872, debugPort = 14873;
const api = `http://127.0.0.1:${apiPort}`, ui = `http://127.0.0.1:${uiPort}`;
const env = { PATH: process.env.PATH, NODE_ENV: 'development', DOTENV_CONFIG_PATH: '/dev/null', PORT: String(apiPort), CORS_ORIGINS: ui, PUBLIC_API_URL: api, AUTH_TOKEN_SECRET: 'isolated-checkout-review-secret-1234567890', ADMIN_EMAIL: 'review@example.com', ADMIN_PASSWORD: 'Review-only-123!', ADMIN_NAME: 'Revisión', VITE_GRAPHQL_URL: `${api}/graphql`, GRAPHQL_RATE_LIMIT_PER_MINUTE: '600', MAX_PENDING_ORDERS_PER_CUSTOMER: '20', CUSTOMER_ACCOUNTS: 'on', MAIL_MODE: 'simulated', STORE_URL: ui, EMAIL_DOMAIN_CHECK: 'off' };
const processes = [], logs = [], exceptions = [], checks = [];
let socket, inspect;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const launch = (command, args, options = {}) => {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...options });
  processes.push(child); child.stdout.on('data', data => logs.push(String(data))); child.stderr.on('data', data => logs.push(String(data))); child.on('error', error => logs.push(error.message)); return child;
};
async function waitFor(fn, label) { let last; for (let i = 0; i < 120; i++) { try { const value = await fn(); if (value) return value; } catch (error) { last = error; } await delay(150); } throw new Error(`No se cumplió: ${label}${last ? ` (${last.message})` : ''}`); }
async function gql(query, variables = {}, token = '') { const response = await fetch(`${api}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) }); const body = await response.json(); if (body.errors) throw new Error(body.errors[0].message); return body.data; }
try {
  for (const port of [apiPort, uiPort, debugPort]) { let occupied = false; try { await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) }); occupied = true; } catch {} assert(!occupied, `Puerto ocupado: ${port}`); }
  const build = launch(process.execPath, ['node_modules/vite/bin/vite.js', 'build', 'apps/web', '--outDir', join(out, 'dist')], { env: { ...env, NODE_ENV: 'production' } });
  assert.equal(await new Promise(resolve => build.on('exit', resolve)), 0, 'Build temporal');
  launch(process.execPath, ['--import', 'tsx', 'apps/api/src/server.ts']);
  launch(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', 'apps/web', '--outDir', join(out, 'dist'), '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort']);
  await waitFor(async () => (await fetch(`${api}/health`)).ok, 'API'); await waitFor(async () => (await fetch(ui)).ok, 'Tienda');
  const { login: { token: admin } } = await gql('mutation($input:LoginInput!){login(input:$input){token}}', { input: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } });
  const sku = `REV-CUENTA-${Date.now()}`;
  const { upsertProduct: product } = await gql('mutation($payload:JSON!){upsertProduct(payload:$payload){id title}}', { payload: { title: 'Proteína de revisión', brand: 'Marca de revisión', slug: `proteina-revision-${Date.now()}`, shortDescription: 'Producto sintético para revisar el checkout con cuenta.', productType: 'SUPPLEMENT', nutritionalFacts: { servingSize: '30 g', calories: 100, protein: 20, carbohydrates: 3, fats: 1 }, categories: [{ name: 'Prueba', slug: 'prueba' }], goals: [{ name: 'Desarrollo muscular', slug: 'desarrollo-muscular' }], featured: false, variants: [{ sku, flavor: 'Vainilla', size: { value: 1, unit: 'kg' }, price: 30, stock: 50, images: [{ url: '/assets/brands/raw-nutrition.png', alt: 'Foto de prueba' }] }] } }, admin);
  const cart = JSON.stringify({ version: 1, expiresAt: Date.now() + 3600000, items: [{ productId: product.id, variantSku: sku, title: product.title, variantLabel: 'Vainilla · 1 kg', unitPrice: 30, quantity: 1 }] });

  // Cliente sintético confirmado por el buzón simulado.
  const email = `ana-${Date.now()}@example.test`, password = 'Cuenta-revision-2026';
  await gql('mutation($i:RegisterInput!){register(input:$i){accepted}}', { i: { name: 'Ana Revisión', email, password } });
  const mail = await waitFor(async () => (await gql('query($to:String){simulatedMailbox(to:$to)}', { to: email }, admin)).simulatedMailbox[0], 'Correo de confirmación');
  await gql('mutation($t:String!){verifyEmail(token:$t)}', { t: decodeURIComponent(/#verificar=([^"&]+)/.exec(mail.html)[1]) });

  launch(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(out, 'chrome')}`, 'about:blank']);
  const tabs = await waitFor(async () => { const items = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); return items.length && items; }, 'Chrome');
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let serial = 0;
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); } if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text); });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method}`)); }, 20000); pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
  const js = async expression => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'JS error'); return result.result.value; };
  const click = selector => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('No existe '+${JSON.stringify(selector)});e.focus();e.click();return true})()`);
  const clickText = (selector, text) => js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.trim().startsWith(${JSON.stringify(text)}));if(!e)throw new Error('No existe '+${JSON.stringify(text)});e.focus();e.click();return true})()`);
  const fill = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('No existe '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  const choose = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('No existe '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  const tick = text => js(`(()=>{const l=[...document.querySelectorAll('.cart-drawer label.choice')].find(n=>n.textContent.includes(${JSON.stringify(text)}));if(!l)throw new Error('No existe opción '+${JSON.stringify(text)});const i=l.querySelector('input');i.click();return i.checked})()`);
  const has = text => waitFor(() => js(`document.body.innerText.includes(${JSON.stringify(text)})`), text);
  const shot = async name => { await delay(200); const result = await cdp('Page.captureScreenshot', { format: 'png' }); await writeFile(join(out, `${name}.png`), Buffer.from(result.data, 'base64')); };
  const openCheckout = async () => {
    await js(`localStorage.setItem("rawenergy-cart-v1", ${JSON.stringify(cart)})`);
    await cdp('Page.reload'); await waitFor(() => js('document.querySelector(".cart-icon b")?.textContent==="1"'), 'Carrito cargado');
    await click('.cart-button'); await waitFor(() => js('!!document.querySelector(".cart-drawer.is-open .drawer-foot .checkout")'), 'Carrito abierto');
    await click('.drawer-foot .checkout'); await has('Datos de entrega');
  };
  const confirm = async () => {
    await waitFor(() => js('(()=>{const b=document.querySelector(".drawer-foot-split .checkout");return b&&!b.disabled&&b.textContent.includes("Confirmar pedido")})()'), 'Total listo');
    await click('.drawer-foot-split .checkout');
    // Protección existente (P02): mismos productos hace menos de 30 minutos; aquí se confirma a propósito.
    const repeat = await waitFor(() => js('document.querySelector(".repeat-order") ? "repeat" : document.querySelector(".order-success, .checkout-error, .field-error[role=alert]") ? "done" : ""'), 'Respuesta al confirmar');
    if (repeat === 'repeat') await clickText('.repeat-order .btn', 'Sí, hacer otro pedido');
  };
  const myOrders = async token => (await gql('{myOrders{orderNumber customer{fullName phone address city idNumber} recipient{name phone sameAsBuyer addressLabel} invoice{name idNumber sameAsBuyer}}}', {}, token)).myOrders;
  inspect = async () => { await shot('failure'); return js('location.href+"\\n"+JSON.stringify([...document.querySelectorAll(".field-error,.checkout-error,.notice")].map(e=>e.textContent))+"\\n"+JSON.stringify([...document.querySelectorAll(".cart-drawer input,.cart-drawer select")].map(e=>[e.id||e.name,e.type==="radio"||e.type==="checkbox"?e.checked:e.value]))'); };
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable'); await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp('Network.setBlockedURLs', { urls: ['https://*'] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: ui }); await waitFor(() => js('document.readyState==="complete"'), 'Portada');

  // 1. Invitado: formulario de siempre y opción de entrar.
  await openCheckout();
  assert(await js('!!document.querySelector("#checkout-fullName") && !document.querySelector(".saved-details")'), 'Invitado con el formulario de siempre');
  await fill('#checkout-fullName', 'Escrito Antes');
  await clickText('.cart-drawer .btn-link', '¿Tienes cuenta?');
  await waitFor(() => js('!!document.querySelector("#auth-email")'), 'Diálogo de acceso');
  assert(await js('!document.querySelector(".cart-drawer.is-open")'), 'El carrito se cierra: no se superponen diálogos');
  await fill('#auth-email', email); await fill('#auth-password', password);
  await click('.auth-card .btn-block');
  await waitFor(() => js('!!document.querySelector(".cart-drawer.is-open") && !document.querySelector(".auth-card")'), 'Vuelve al carrito');
  await has('Sesión iniciada, Ana.');
  await has('¿Quieres usarlos en lugar de lo que escribiste?');
  assert.equal(await js('document.querySelector("#checkout-fullName").value'), 'Escrito Antes', 'No se reemplaza lo escrito sin preguntar');
  checks.push('Entrar desde el checkout: el carrito se cierra para el acceso y vuelve al mismo paso con «Sesión iniciada» y la pregunta antes de reemplazar lo escrito');

  // 2. Perfil vacío: solo pide lo que falta; guarda en la cuenta lo marcado; contra entrega que deja de aplicar.
  assert(await js('[...document.querySelectorAll("button")].some(b=>b.textContent.includes("Usar BIENVENIDA10"))'), 'Cuenta nueva: se ofrece el código de bienvenida');
  await clickText('.saved-ask .btn', 'Usar mis datos guardados');
  await waitFor(() => js('!!document.querySelector(".saved-details")'), 'Datos guardados');
  await fill('#checkout-phone', '0991234567'); assert(await tick('Guardar este celular'));
  await fill('#checkout-idNumber', '0926687856'); assert(await tick('Guardar para mis próximas compras'));
  await choose('#checkout-province', 'Pichincha'); await choose('#checkout-city', 'Quito');
  await fill('#checkout-address', 'Av. Amazonas N24-100 y Colón');
  assert(await tick('Guardar en mis direcciones')); await fill('#checkout-addressLabel', 'Casa');
  await click('input[name="shippingMethod"]'); // express
  await waitFor(() => js('!document.querySelectorAll("input[name=paymentMethod]")[1].disabled'), 'Contra entrega disponible');
  await js('document.querySelectorAll("input[name=paymentMethod]")[1].click()');
  await choose('#checkout-province', 'Guayas'); await choose('#checkout-city', 'Guayaquil');
  await has('Contra entrega ya no está disponible para este pedido');
  assert(await js('![...document.querySelectorAll("input[name=paymentMethod]")].some(i=>i.checked)'), 'No se elige otra forma de pago en silencio');
  await choose('#checkout-province', 'Pichincha'); await choose('#checkout-city', 'Quito');
  await confirm();
  await has('Elige la forma de pago.');
  await waitFor(() => js('document.activeElement?.id==="checkout-paymentMethod"'), 'Foco en la forma de pago');
  await click('#checkout-paymentMethod');
  await shot('01-datos-faltantes');
  await confirm(); await has('Pedido recibido');
  await has('Guardamos en tu cuenta lo que marcaste.');
  const session = await js('localStorage.getItem("rawenergy-token")');
  const profile = (await gql('{myProfile{phone billing{idNumber} addresses{label city isDefault}}}', {}, session)).myProfile;
  assert.equal(profile.phone, '0991234567'); assert.equal(profile.billing.idNumber, '0926687856');
  assert.deepEqual(profile.addresses, [{ label: 'Casa', city: 'Quito', isDefault: true }]);
  checks.push('Perfil incompleto: pide solo celular, factura y dirección; contra entrega que deja de aplicar se explica sin elegir otra en silencio; falta de forma de pago enfocada; lo marcado queda guardado tras el pedido');

  // 3. Perfil completo: compra sin escribir ningún dato personal.
  await click('.order-success .btn-block:last-of-type').catch(() => undefined);
  await openCheckout();
  await waitFor(() => js('!!document.querySelector(".saved-details")'), 'Datos guardados directos');
  assert.equal(await js('document.querySelectorAll(".saved-details input:not([type=radio]):not([type=checkbox])").length'), 0, 'Ningún campo personal para escribir');
  assert(await js('document.querySelector(".saved-addresses input[type=radio]").checked'), 'Dirección predeterminada elegida');
  assert(await js('![...document.querySelectorAll("button")].some(b=>b.textContent.includes("Usar BIENVENIDA10"))'), 'Cuenta que ya compró: no se ofrece el código de bienvenida');
  await has('Casa');
  await shot('02-perfil-completo');
  await confirm(); await has('Pedido recibido');
  let orders = await myOrders(session);
  assert.equal(orders[0].customer.address, 'Av. Amazonas N24-100 y Colón');
  assert.equal(orders[0].recipient.sameAsBuyer, true); assert.equal(orders[0].recipient.addressLabel, 'Casa');
  checks.push('Perfil completo: compra con cero campos personales escritos, dirección predeterminada elegida y copiada en el pedido');

  // 4. Entregar a otra persona: comprador y factura no cambian.
  await openCheckout();
  await waitFor(() => js('!!document.querySelector(".saved-details")'), 'Datos guardados');
  assert(await tick('La recibe otra persona'));
  await fill('#checkout-recipientName', 'Luis Pérez'); await fill('#checkout-recipientPhone', '0987654321');
  await confirm(); await has('Pedido recibido');
  orders = await myOrders(session);
  assert.deepEqual(orders[0].recipient, { name: 'Luis Pérez', phone: '0987654321', sameAsBuyer: false, addressLabel: 'Casa' });
  assert.equal(orders[0].customer.fullName, 'Ana Revisión'); assert.equal(orders[0].invoice.sameAsBuyer, true);
  checks.push('Entregar a otra persona: destinatario propio; comprador y factura sin cambios');

  // 5. Dirección editada en otra pestaña durante la compra: no se crea pedido y se carga la versión actual.
  await openCheckout();
  await waitFor(() => js('!!document.querySelector(".saved-details")'), 'Datos guardados');
  const { myProfile: current } = await gql('{myProfile{revision addresses{id}}}', {}, session);
  await gql('mutation($id:ID!,$i:CustomerAddressInput!,$r:Int!){updateMyAddress(id:$id,input:$i,revision:$r){revision}}', { id: current.addresses[0].id, i: { label: 'Casa', province: 'Pichincha', city: 'Quito', address: 'Av. Amazonas N24-300 y Colón' }, r: current.revision }, session);
  const before = (await myOrders(session)).length;
  await confirm();
  await has('Tu dirección cambió mientras comprabas');
  assert.equal((await myOrders(session)).length, before, 'Sin pedido con la dirección anterior');
  await has('Av. Amazonas N24-300 y Colón');
  await confirm(); await has('Pedido recibido');
  assert.equal((await myOrders(session))[0].customer.address, 'Av. Amazonas N24-300 y Colón');
  checks.push('Dirección editada en otra pestaña: aviso sin pedido, versión actual cargada y segundo intento con la dirección nueva');

  // 6. 360 px: sin desbordamiento en la entrega con datos guardados.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await openCheckout();
  await waitFor(() => js('!!document.querySelector(".saved-details")'), 'Datos guardados móvil');
  assert(await js('(()=>{const f=document.querySelector(".checkout-form");return f.scrollWidth<=f.clientWidth+1})()'), 'Sin desbordamiento horizontal a 360 px');
  await shot('03-movil');
  checks.push('360 px: entrega con datos guardados sin desbordamiento');

  assert.deepEqual(exceptions, []);
  await writeFile(join(out, 'report.json'), JSON.stringify({ ok: true, checks, caveats: ['API en memoria, build local, Chrome sin interfaz y datos sintéticos'] }, null, 2));
  console.log(JSON.stringify({ ok: true, artifacts: out, checks }, null, 2));
} catch (error) {
  if (inspect) try { await writeFile(join(out, 'screen.txt'), await inspect()); } catch {}
  await writeFile(join(out, 'failure.log'), `${error.stack}\n${logs.join('').slice(-12000)}`); console.error(error.message); console.error(`Diagnóstico: ${out}`); process.exitCode = 1;
} finally { socket?.close(); for (const child of processes.reverse()) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); } }
