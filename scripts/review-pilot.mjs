// CU14: recorrido del piloto de cuentas contra las direcciones reales en Azure (tienda, panel y API del piloto).
// Datos sintéticos en la base rawenergy_stage_cuentas_*; correo simulado. Las credenciales del administrador del
// piloto se leen de la configuración de Azure y no se muestran; el secreto del segundo factor solo vive en memoria.
// Uso: node scripts/review-pilot.mjs   (requiere sesión de Azure CLI y Chrome)
import { execFileSync, spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const GROUP = 'rawenergy-staging-rg', APP = 'rawenergy-api-cuentas';
const store = 'https://delightful-tree-01b063a10.1.azurestaticapps.net', panel = 'https://orange-water-00d0a8710.1.azurestaticapps.net', api = `https://${APP}.azurewebsites.net`;
const out = await mkdtemp(join(tmpdir(), 'rawenergy-pilot-review-'));
const debugPort = 14941;
const checks = [], exceptions = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const az = (...args) => execFileSync('az', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const settings = Object.fromEntries(JSON.parse(az('webapp', 'config', 'appsettings', 'list', '-g', GROUP, '-n', APP, '-o', 'json')).map(s => [s.name, s.value]));
const admin = { email: settings.ADMIN_EMAIL, password: settings.ADMIN_PASSWORD };
async function waitFor(fn, label, tries = 160) { let last; for (let i = 0; i < tries; i++) { try { const value = await fn(); if (value) return value; } catch (error) { last = error; } await delay(250); } throw new Error(`No se cumplió: ${label}${last ? ` (${last.message})` : ''}`); }
async function gqlRaw(query, variables = {}, token = '') { const response = await fetch(`${api}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) }); return response.json(); }
async function gql(query, variables = {}, token = '') { const body = await gqlRaw(query, variables, token); if (body.errors) throw new Error(`${body.errors[0].extensions?.code ?? ''} ${body.errors[0].message}`); return body.data; }

// TOTP (RFC 6238) con el mismo cálculo que la API.
const base32 = text => { const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of text.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0'); const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(bytes); };
let totpSecret = '', lastStep = -1;
async function totp() {
  let step = Math.floor(Date.now() / 30000);
  while (step <= lastStep) { await delay(1000); step = Math.floor(Date.now() / 30000); }
  lastStep = step;
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32(totpSecret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
async function adminSession() {
  let first = await gqlRaw('mutation($i:LoginInput!){login(input:$i){token user{twoFactorEnabled}}}', { i: { email: admin.email, password: admin.password } });
  if (first.errors?.[0]?.extensions?.code === 'MFA_REQUIRED') {
    // Una corrida anterior activó el segundo factor y su secreto no se guardó: se crea otro administrador sintético
    // (la API lo crea al arrancar con ADMIN_EMAIL/ADMIN_PASSWORD si no existe).
    admin.email = `piloto-admin-${Date.now()}@example.test`;
    az('webapp', 'config', 'appsettings', 'set', '-g', GROUP, '-n', APP, '--settings', `ADMIN_EMAIL=${admin.email}`, '--query', 'length(@)', '-o', 'tsv');
    first = await waitFor(async () => { const r = await gqlRaw('mutation($i:LoginInput!){login(input:$i){token user{twoFactorEnabled}}}', { i: { email: admin.email, password: admin.password } }); return r.data?.login ? r : null; }, 'Administrador nuevo tras reiniciar', 600);
  }
  if (first.errors) throw new Error(first.errors[0].message);
  const setup = await gql('mutation{startTwoFactorSetup{secret}}', {}, first.data.login.token);
  totpSecret = setup.startTwoFactorSetup.secret;
  const recovery = await gql('mutation($c:String!){confirmTwoFactorSetup(code:$c){recoveryCodes}}', { c: await totp() }, first.data.login.token);
  assert(recovery.confirmTwoFactorSetup.recoveryCodes.length > 0);
  return (await gql('mutation($i:LoginInput!){login(input:$i){token}}', { i: { email: admin.email, password: admin.password, code: await totp() } })).login.token;
}
const setAccounts = async value => {
  az('webapp', 'config', 'appsettings', 'set', '-g', GROUP, '-n', APP, '--settings', `CUSTOMER_ACCOUNTS=${value}`, '--query', 'length(@)', '-o', 'tsv');
  await waitFor(async () => (await gqlRaw('{checkoutInfo{customerAccounts}}')).data?.checkoutInfo.customerAccounts === (value === 'on'), `Cuentas ${value} tras reiniciar`, 600);
};

let chrome, socket, inspect;
try {
  // 0. Preparación: segundo factor del administrador (obligatorio en el piloto) y productos sintéticos.
  assert.equal((await (await fetch(`${api}/health`)).json()).status, 'ok');
  assert.equal((await gql('{checkoutInfo{customerAccounts}}')).checkoutInfo.customerAccounts, true);
  const adminToken = await adminSession();
  const products = [];
  for (const [title, price] of [['Proteína del piloto', 30], ['Creatina del piloto', 25]]) {
    const sku = `PILOTO-${randomUUID().slice(0, 8)}`;
    const { upsertProduct } = await gql('mutation($p:JSON!){upsertProduct(payload:$p){id title}}', { p: { title, brand: 'Marca del piloto', slug: `${title.toLowerCase().replace(/[^a-z]+/g, '-')}-${Date.now()}`, shortDescription: 'Producto sintético del piloto de cuentas, sin venta real.', productType: 'SUPPLEMENT', nutritionalFacts: { servingSize: '30 g', calories: 100, protein: 20, carbohydrates: 3, fats: 1 }, categories: [{ name: 'Piloto', slug: 'piloto' }], goals: [{ name: 'Desarrollo muscular', slug: 'desarrollo-muscular' }], featured: false, variants: [{ sku, flavor: 'Vainilla', size: { value: 1, unit: 'kg' }, price, stock: 80, images: [] }] } }, adminToken);
    products.push({ id: upsertProduct.id, sku, title, price });
  }
  checks.push('Preparación: API del piloto sana con cuentas activas; segundo factor del administrador configurado; 2 productos sintéticos');

  chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(out, 'chrome')}`, 'about:blank'], { stdio: 'ignore', detached: true });
  const tabs = await waitFor(async () => { const items = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); return items.length && items; }, 'Chrome');
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let serial = 0;
  socket.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { const task = pending.get(m.id); pending.delete(m.id); m.error ? task.reject(new Error(m.error.message)) : task.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method}`)); }, 30000); pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
  const js = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'JS error'); return r.result.value; };
  const click = selector => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('No existe '+${JSON.stringify(selector)});e.focus();e.click();return true})()`);
  const clickText = (selector, text) => js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.trim().startsWith(${JSON.stringify(text)})&&n.getClientRects().length);if(!e)throw new Error('No existe '+${JSON.stringify(text)});e.focus();e.click();return true})()`);
  const fill = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('No existe '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  const choose = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('No existe '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  const tick = text => js(`(()=>{const l=[...document.querySelectorAll('label.choice')].find(n=>n.textContent.includes(${JSON.stringify(text)})&&n.getClientRects().length);if(!l)throw new Error('No existe opción '+${JSON.stringify(text)});const i=l.querySelector('input');i.click();return i.checked})()`);
  const has = text => waitFor(() => js(`document.body.innerText.includes(${JSON.stringify(text)})`), text);
  const button = text => waitFor(() => js(`[...document.querySelectorAll("button")].some(b=>b.textContent.trim().startsWith(${JSON.stringify(text)})&&b.getClientRects().length)`), `Botón ${text}`);
  const shot = async name => { await delay(400); const r = await cdp('Page.captureScreenshot', { format: 'png' }); await writeFile(join(out, `${name}.png`), Buffer.from(r.data, 'base64')); };
  const go = async url => { await cdp('Page.navigate', { url }); await waitFor(() => js('document.readyState==="complete"'), url); };
  const sessionToken = () => js('localStorage.getItem("rawenergy-token")');
  const toastLog = [];
  inspect = async () => { await shot('failure'); return (await js('location.href+"\\n"+document.body.innerText.slice(0,3000)')) + `\nAvisos observados: ${JSON.stringify(toastLog)}`; };
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable'); await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // 1. Alta y confirmación del correo.
  const email = `piloto-${Date.now()}@example.test`, password = 'Cuenta-piloto-2026';
  await go(`${store}/`);
  await waitFor(() => js('!!document.querySelector(\'.header-action[aria-label="Entrar a mi cuenta"]\')'), 'Cabecera con cuentas activas');
  await click('.header-action[aria-label="Entrar a mi cuenta"]');
  await waitFor(() => js('!!document.querySelector("#auth-email")'), 'Diálogo de acceso');
  await clickText('.auth-switch button', 'Crear cuenta');
  await waitFor(() => js('!!document.querySelector("#auth-name")'), 'Formulario de alta');
  await fill('#auth-name', 'Ana Piloto'); await fill('#auth-email', email); await fill('#auth-password', password);
  await click('.auth-card .btn-block');
  await has('Te enviamos un enlace a');
  const mail = await waitFor(async () => (await gql('query($to:String){simulatedMailbox(to:$to)}', { to: email }, adminToken)).simulatedMailbox[0], 'Correo simulado de confirmación');
  await go(`${store}/#verificar=${decodeURIComponent(/#verificar=([^"&]+)/.exec(mail.html)[1])}`);
  await has('Confirmamos tu correo');
  assert.equal(await js('location.hash'), '');
  await clickText('[aria-labelledby="link-heading"] button', 'Entrar');
  await waitFor(() => js('!!document.querySelector("#auth-email")'), 'Acceso tras confirmar');
  await fill('#auth-email', email); await fill('#auth-password', password);
  await click('.auth-card .btn-block');
  await waitFor(async () => { const now = await js('document.querySelector(".toaster")?.innerText ?? "(sin región)"'); if (now && toastLog.at(-1) !== now) toastLog.push(now); return now.includes('Sesión iniciada, Ana.'); }, 'Aviso «Sesión iniciada, Ana.»');
  await shot('01-sesion-iniciada');
  checks.push('Alta con «revisa tu correo», enlace del buzón simulado confirmado y retirado de la dirección, acceso con «Sesión iniciada, Ana.»');

  // 2. Perfil, factura y dos direcciones.
  await go(`${store}/cuenta`); await button('Editar');
  await click('button[aria-label="Editar datos personales"]'); await fill('#contact-phone', '0991234567'); await clickText('.account-form button', 'Guardar'); await has('Guardamos tus datos.');
  await click('button[aria-label="Agregar datos de factura"]'); await fill('#billing-idNumber', '0926687856'); await clickText('.account-form button', 'Guardar'); await has('Guardamos tus datos de factura.');
  await go(`${store}/cuenta/direcciones`); await button('Agregar dirección');
  for (const [label, province, city, address, other] of [['Casa', 'Pichincha', 'Quito', 'Av. Amazonas N24-100 y Colón', false], ['Oficina', 'Guayas', 'Guayaquil', 'Av. 9 de Octubre 100 y Malecón', true]]) {
    await clickText('.address-book .btn-primary', 'Agregar dirección');
    await fill('#address-new-label', label); await choose('#address-new-province', province); await choose('#address-new-city', city); await fill('#address-new-address', address);
    if (other) { await tick('La recibe otra persona'); await fill('#address-new-recipientName', 'Luis Piloto'); await fill('#address-new-recipientPhone', '0981234567'); }
    await clickText('.account-form button', 'Guardar dirección'); await has(label === 'Casa' ? 'Usaremos esta dirección para tus próximas compras.' : 'Dirección agregada.');
  }
  await shot('02-direcciones');
  checks.push('Mi cuenta: celular y factura guardados; dos direcciones (la primera predeterminada, la segunda con otra persona que recibe)');

  // 3. Compras con datos guardados.
  const cart = item => JSON.stringify({ version: 1, expiresAt: Date.now() + 3600000, items: [{ productId: item.id, variantSku: item.sku, title: item.title, variantLabel: 'Vainilla · 1 kg', unitPrice: item.price, quantity: 1 }] });
  const openCheckout = async item => {
    await js(`localStorage.setItem("rawenergy-cart-v1", ${JSON.stringify(cart(item))})`);
    await go(`${store}/`); await waitFor(() => js('document.querySelector(".cart-icon b")?.textContent==="1"'), 'Carrito');
    await click('.cart-button'); await waitFor(() => js('!!document.querySelector(".cart-drawer.is-open .drawer-foot .checkout")'), 'Carrito abierto');
    await click('.drawer-foot .checkout'); await waitFor(() => js('!!document.querySelector(".saved-details")'), 'Datos guardados');
  };
  const confirm = async () => {
    await waitFor(() => js('(()=>{const b=document.querySelector(".drawer-foot-split .checkout");return b&&!b.disabled&&b.textContent.includes("Confirmar pedido")})()'), 'Total listo');
    await click('.drawer-foot-split .checkout');
    const result = await waitFor(() => js('document.querySelector(".repeat-order")?"repeat":document.querySelector(".order-success")?"done":document.querySelector(".checkout-error")?.textContent||""'), 'Respuesta al confirmar');
    if (result === 'repeat') { await clickText('.repeat-order .btn', 'Sí, hacer otro pedido'); await waitFor(() => js('!!document.querySelector(".order-success")'), 'Pedido tras confirmar repetido'); }
    else assert.equal(result, 'done', `Confirmación: ${result}`);
    return js('document.querySelector(".order-success .eyebrow").textContent.replace("Pedido ","").trim()');
  };
  await openCheckout(products[0]);
  assert.equal(await js('document.querySelectorAll(".saved-details input:not([type=radio]):not([type=checkbox])").length'), 0, 'Cero campos personales');
  const order1 = await confirm();
  await shot('03-compra-sin-escribir');
  await openCheckout(products[1]);
  await click('button[aria-label="Cambiar los datos de factura de este pedido"]'); await fill('#checkout-billingName', 'Empresa Piloto S.A.');
  await tick('La recibe otra persona'); await fill('#checkout-recipientName', 'Marta Piloto'); await fill('#checkout-recipientPhone', '0987654321');
  const order2 = await confirm();
  const customerToken = await sessionToken();
  const placed = (await gql('{myOrdersPage{orders{orderNumber recipient{name sameAsBuyer} invoice{name sameAsBuyer} delivery{address}}}}', {}, customerToken)).myOrdersPage.orders;
  const second = placed.find(o => o.orderNumber === order2);
  assert.deepEqual([second.recipient.name, second.recipient.sameAsBuyer, second.invoice.name, second.invoice.sameAsBuyer], ['Marta Piloto', false, 'Empresa Piloto S.A.', false]);
  checks.push(`Compras: ${order1} sin escribir ningún dato; ${order2} para otra persona y con factura a otro nombre, guardados así en el pedido`);

  // 4. Mis pedidos y cancelación directa.
  await go(`${store}/mis-pedidos`); await waitFor(() => js('document.querySelectorAll(".customer-orders > li").length===2'), 'Dos pedidos en la lista');
  const cancelDirect = async number => {
    await go(`${store}/mis-pedidos/${number}`); await button('Cancelar pedido');
    await clickText('button', 'Cancelar pedido'); await waitFor(() => js('!!document.querySelector(".remove-confirm")'), 'Confirmación');
    const warned = await js('document.body.innerText.includes("Sería tu tercera cancelación seguida")');
    await js('document.querySelectorAll(".remove-confirm input[name=proof]")[0].click()');
    await waitFor(() => js('!document.querySelector(".remove-confirm .btn-danger").disabled'), 'Cancelar habilitado');
    await click('.remove-confirm .btn-danger');
    return warned;
  };
  await cancelDirect(order1); await has('Pedido cancelado. Los productos volvieron al catálogo.');
  checks.push(`Mis pedidos: 2 tarjetas; ${order1} cancelado directamente por la cliente (sin comprobante)`);

  // 5. Solicitudes: el equipo aprueba una (pagado) y rechaza otra (pago por verificar) desde el panel.
  const idOf = async number => (await gql('query($f:OrderFiltersInput){orders(filters:$f){orders{id orderNumber}}}', { f: { search: number } }, adminToken)).orders.orders.find(o => o.orderNumber === number).id;
  await gql('mutation($id:ID!){updateOrderStatus(id:$id,status:PAID){status}}', { id: await idOf(order2) }, adminToken);
  const requestFor = async number => {
    await go(`${store}/mis-pedidos/${number}`); await button('Solicitar cancelación');
    await clickText('button', 'Solicitar cancelación'); await waitFor(() => js('!!document.querySelector("#request-reason")'), 'Motivo');
    await choose('#request-reason', 'DELAY'); await clickText('.request-cancel button', 'Enviar solicitud'); await has('Tu solicitud de cancelación está en revisión');
  };
  await requestFor(order2);
  await openCheckout(products[0]); const order3 = await confirm();
  await gql('mutation($id:ID!){updateOrderStatus(id:$id,status:PAYMENT_REVIEW){status}}', { id: await idOf(order3) }, adminToken);
  await requestFor(order3);
  await go(`${panel}/`); await has('Iniciar sesión');
  const setInput = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await setInput('input[type=email]', admin.email); await setInput('input[type=password]', admin.password); await clickText('button', 'Entrar al panel');
  await waitFor(() => js('!!document.querySelector("#login-code")'), 'Panel pide el código');
  await setInput('#login-code', await totp()); await clickText('button', 'Entrar al panel');
  await has('Productos activos');
  await clickText('.sidebar nav button', 'Pedidos');
  const article = number => `[...document.querySelectorAll(".cancellation-requests article")].find(a=>a.textContent.includes(${JSON.stringify(number)}))`;
  // Puede haber solicitudes de corridas anteriores: se esperan las dos de esta corrida por su número.
  await waitFor(() => js(`!!${article(order2)} && !!${article(order3)}`), 'Las dos solicitudes en el panel');
  await js(`${article(order2)}.querySelector(".danger-button").click()`); await waitFor(() => js('!!document.querySelector(".confirm-dialog")'), 'Confirmar aprobación');
  await clickText('.confirm-dialog button', 'Aprobar y cancelar'); await has(`Pedido ${order2} cancelado.`);
  await js(`(()=>{const e=${article(order3)}.querySelector("input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"Ya validamos tu pago y el pedido sale hoy.");e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await js(`[...${article(order3)}.querySelectorAll("button")].find(b=>b.textContent==="Rechazar").click()`); await waitFor(() => js('!!document.querySelector(".confirm-dialog")'), 'Confirmar rechazo');
  await clickText('.confirm-dialog button', 'Rechazar solicitud'); await has(`Solicitud de ${order3} rechazada.`);
  await shot('04-panel-solicitudes');
  await go(`${store}/mis-pedidos/${order2}`); await has('Cancelado por nuestro equipo a tu pedido'); await has('Reembolso pendiente');
  await go(`${store}/mis-pedidos/${order3}`); await has('No pudimos cancelar tu pedido: Ya validamos tu pago y el pedido sale hoy.');
  checks.push(`Solicitudes: ${order2} (pagado) aprobado en el panel con «Reembolso pendiente» para la cliente; ${order3} (pago por verificar) rechazado con el motivo visible para la cliente; el panel exigió el código del segundo factor`);

  // 6. Bloqueo tras 3 cancelaciones seguidas y desbloqueo.
  // El pago de la solicitud aprobada reinició el contador (regla del propietario): hacen falta 3 cancelaciones
  // seguidas desde aquí. Se crean de una en una por el límite de 2 pedidos pendientes por persona.
  await openCheckout(products[1]); const order4 = await confirm();
  assert.equal(await cancelDirect(order4), false); await has('Pedido cancelado.');
  await openCheckout(products[1]); const order5 = await confirm();
  assert.equal(await cancelDirect(order5), false); await has('Pedido cancelado.');
  await openCheckout(products[1]); const order6 = await confirm();
  assert.equal(await cancelDirect(order6), true, 'Aviso antes de la tercera');
  await has('Tu cuenta quedó bloqueada por seguridad');
  await waitFor(() => js('localStorage.getItem("rawenergy-token")===null'), 'Sesión cerrada');
  const blocked = await gqlRaw('mutation($i:LoginInput!){login(input:$i){token}}', { i: { email, password } });
  assert.equal(blocked.errors?.[0]?.extensions?.code, 'ACCOUNT_BLOCKED');
  await shot('05-bloqueo');
  const account = (await gql('query($f:JSON){accounts(filters:$f)}', { f: { search: email } }, adminToken)).accounts.rows.find(u => u.email === email);
  await gql('mutation($id:ID,$i:JSON!){saveAccount(id:$id,input:$i){status}}', { id: account.id, i: { name: account.name, email, role: 'CUSTOMER', status: 'ACTIVE' } }, adminToken);
  assert((await gql('mutation($i:LoginInput!){login(input:$i){token}}', { i: { email, password } })).login.token);
  checks.push(`Bloqueo: el pago aprobado reinició el contador; aviso antes de la tercera cancelación seguida (${order6}); cuenta bloqueada, sesión cerrada y acceso con mensaje neutral; desbloqueo como en «Usuarios y permisos» y la cliente vuelve a entrar`);

  // 7. Apagar las cuentas (reversión) y volver a encenderlas.
  const before = (await gql('{orders{totalCount}}', {}, adminToken)).orders.totalCount;
  await setAccounts('off');
  await go(`${store}/`); await waitFor(() => js('!!document.querySelector(".header-action[aria-label=\\"Consulta tu pedido\\"]")'), 'Tienda en modo invitado');
  const off = await gqlRaw('mutation($i:LoginInput!){login(input:$i){token}}', { i: { email, password } });
  assert.match(off.errors?.[0]?.message ?? '', /ya no usa cuentas/);
  const { calculateCartTotals } = await gql('query($c:[CartItemInput!]!){calculateCartTotals(cartItems:$c, shippingMethod:SERVIENTREGA_NATIONAL){total}}', { c: [{ productId: products[0].id, variantSku: products[0].sku, quantity: 1 }] });
  await gql('mutation($i:CheckoutInput!){createCheckoutOrder(input:$i){orderNumber}}', { i: { idempotencyKey: randomUUID(), expectedTotal: calculateCartTotals.total, customer: { fullName: 'Invitado Piloto', email: `invitado-${Date.now()}@example.test`, phone: '0997776655', province: 'Pichincha', city: 'Quito', address: 'Calle de prueba 456', idNumber: '1710034065' }, items: [{ productId: products[0].id, variantSku: products[0].sku, quantity: 1 }], shippingMethod: 'SERVIENTREGA_NATIONAL', paymentMethod: 'BANK_TRANSFER' } });
  assert.equal((await gql('{orders{totalCount}}', {}, adminToken)).orders.totalCount, before + 1, 'Nada se borró y la compra como invitado funciona');
  await setAccounts('on');
  const back = await gql('mutation($i:LoginInput!){login(input:$i){token}}', { i: { email, password } });
  assert.equal((await gql('{myOrdersPage(first:20){orders{orderNumber}}}', {}, back.login.token)).myOrdersPage.orders.length, 6);
  checks.push('Reversión: con las cuentas apagadas la tienda pasa a modo invitado, el acceso se rechaza, se compra como invitado y no se pierde nada; al encenderlas la cliente entra y ve sus 6 pedidos');

  // 8. Celular (390 px): sin desbordamiento en cuenta, pedidos y entrega.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go(`${store}/`); await js(`localStorage.setItem("rawenergy-token", ${JSON.stringify(back.login.token)}); localStorage.setItem("rawenergy-user", JSON.stringify(${JSON.stringify({ id: account.id, name: 'Ana Piloto', email, role: 'CUSTOMER', status: 'ACTIVE', emailVerified: true })}))`);
  for (const path of ['/cuenta', '/cuenta/direcciones', '/mis-pedidos', `/mis-pedidos/${order3}`]) { await go(`${store}${path}`); await waitFor(() => js('!!document.querySelector(".account-card, .customer-orders li, .order-detail")'), path); assert(await js('document.documentElement.scrollWidth<=innerWidth'), `Desbordamiento a 390 px: ${path}`); }
  await shot('06-movil-pedido');
  await openCheckout(products[0]); assert(await js('(()=>{const f=document.querySelector(".checkout-form");return f.scrollWidth<=f.clientWidth+1})()'), 'Entrega a 390 px');
  await shot('07-movil-entrega');
  checks.push('Celular 390 px: cuenta, direcciones, Mis pedidos, detalle y entrega con datos guardados sin desbordamiento');

  assert.deepEqual(exceptions, []);
  await writeFile(join(out, 'report.json'), JSON.stringify({ ok: true, store, panel, api, checks }, null, 2));
  console.log(JSON.stringify({ ok: true, artifacts: out, checks }, null, 2));
} catch (error) {
  if (inspect) try { await writeFile(join(out, 'screen.txt'), await inspect()); } catch {}
  await writeFile(join(out, 'failure.log'), `${error.stack}`); console.error(error.message); console.error(`Diagnóstico: ${out}`); process.exitCode = 1;
} finally { socket?.close(); if (chrome) try { process.kill(-chrome.pid); } catch {} }
