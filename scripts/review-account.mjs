// CU05: recorrido real de la cuenta en Chrome sin interfaz. API en memoria con cuentas y correo simulado,
// build temporal y perfil nuevo; no usa datos ni servicios reales. Uso: node scripts/review-account.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('.');
const out = await mkdtemp(join(tmpdir(), 'rawenergy-account-review-'));
const apiPort = 14861, uiPort = 14862, debugPort = 14863;
const api = `http://127.0.0.1:${apiPort}`, ui = `http://127.0.0.1:${uiPort}`;
const env = { PATH: process.env.PATH, NODE_ENV: 'development', DOTENV_CONFIG_PATH: '/dev/null', PORT: String(apiPort), CORS_ORIGINS: ui, PUBLIC_API_URL: api, AUTH_TOKEN_SECRET: 'isolated-account-review-secret-1234567890', ADMIN_EMAIL: 'review@example.com', ADMIN_PASSWORD: 'Review-only-123!', ADMIN_NAME: 'Revisión', VITE_GRAPHQL_URL: `${api}/graphql`, GRAPHQL_RATE_LIMIT_PER_MINUTE: '400', CUSTOMER_ACCOUNTS: 'on', MAIL_MODE: 'simulated', STORE_URL: ui };
const processes = [], logs = [], exceptions = [], checks = [], accessibility = [];
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

  // Alta y enlace de confirmación desde el buzón simulado (CU02/CU04).
  const email = `ana-${Date.now()}@example.test`, password = 'Cuenta-revision-2026';
  await gql('mutation($i:RegisterInput!){register(input:$i){accepted}}', { i: { name: 'Ana Revisión', email, password } });
  const mail = await waitFor(async () => (await gql('query($to:String){simulatedMailbox(to:$to)}', { to: email }, admin)).simulatedMailbox[0], 'Correo de confirmación');
  const verifyToken = decodeURIComponent(/#verificar=([^"&]+)/.exec(mail.html)[1]);

  launch(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(out, 'chrome')}`, 'about:blank']);
  const tabs = await waitFor(async () => { const items = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); return items.length && items; }, 'Chrome');
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let serial = 0;
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); } if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text); });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method}`)); }, 20000); pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
  const js = async expression => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'JS error'); return result.result.value; };
  const click = selector => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('No existe '+${JSON.stringify(selector)});e.focus();e.click();return true})()`);
  const clickText = (selector, text) => js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('No existe '+${JSON.stringify(text)});e.focus();e.click();return true})()`);
  const fill = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('No existe campo');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  const choose = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('No existe '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  const check = selectorText => js(`(()=>{const l=[...document.querySelectorAll('label.choice')].find(n=>n.textContent.includes(${JSON.stringify(selectorText)}));if(!l)throw new Error('No existe opción');l.querySelector('input').click();return true})()`);
  const focusedId = () => js('document.activeElement?.id||document.activeElement?.textContent?.trim()');
  const has = text => waitFor(() => js(`document.body.innerText.includes(${JSON.stringify(text)})`), text);
  const shot = async name => { await delay(200); const result = await cdp('Page.captureScreenshot', { format: 'png' }); await writeFile(join(out, `${name}.png`), Buffer.from(result.data, 'base64')); };
  const inspectAccessibility = async label => {
    const tree = await cdp('Accessibility.getFullAXTree');
    const controls = tree.nodes.filter(node => !node.ignored && ['button', 'textbox', 'link'].includes(node.role?.value));
    const unnamed = controls.filter(node => !node.name?.value?.trim()).map(node => node.role.value);
    accessibility.push({ label, controls: controls.length, unnamed });
    assert.deepEqual(unnamed, [], `Controles sin nombre accesible: ${label}`);
    assert.equal(await js('document.querySelectorAll("h1").length'), 1, `Un h1: ${label}`);
  };
  const go = async path => { await cdp('Page.navigate', { url: `${ui}${path}` }); await waitFor(() => js('document.readyState==="complete"'), path); };
  inspect = () => js('location.href+"\\n"+document.body.innerText.slice(0,3000)');
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable'); await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp('Network.setBlockedURLs', { urls: ['https://*'] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // 1. Enlace de confirmación con la tienda ya abierta (solo cambia el fragmento): se usa, el token sale de la
  // dirección y entrar desde ese diálogo confirma el acceso con el aviso.
  await go('/');
  await js(`location.hash = ${JSON.stringify(`verificar=${encodeURIComponent(verifyToken)}`)}`);
  await has('Confirmamos tu correo');
  assert.equal(await js('location.hash'), '', 'El token no queda en la dirección');
  await shot('01-correo-confirmado');
  await clickText('.auth-card button', 'Entrar');
  await waitFor(() => js('!!document.querySelector("#auth-email")'), 'Acceso desde el enlace');
  await fill('#auth-email', email); await fill('#auth-password', password);
  await click('.auth-card .btn-block');
  await waitFor(() => js('[...document.querySelectorAll(".toaster .toast")].some(t=>t.textContent.includes("Sesión iniciada, Ana."))'), 'Aviso al entrar desde el enlace');
  await click('.account-menu .header-action'); await clickText('#menu-cuenta button', 'Cerrar sesión');
  await waitFor(() => js('localStorage.getItem("rawenergy-token")===null'), 'Sesión cerrada para seguir');
  checks.push('Enlace de confirmación abierto con la tienda ya cargada: diálogo, token retirado de la dirección y acceso con «Sesión iniciada»');

  // 2. Sección privada sin sesión: pide entrar y conserva la ruta.
  await go('/cuenta');
  await has('Entra a tu cuenta para ver esta sección');
  await inspectAccessibility('Cuenta sin sesión');
  await click('.status-page .btn-primary');
  await waitFor(() => js('!!document.querySelector("#auth-email")'), 'Diálogo de acceso');
  await fill('#auth-email', email); await fill('#auth-password', password);
  await click('.auth-card .btn-block');
  await waitFor(() => js('!document.querySelector(".auth-card")'), 'Diálogo cerrado');
  await waitFor(() => js('[...document.querySelectorAll(".toaster .toast")].some(t=>t.textContent.includes("Sesión iniciada, Ana."))'), 'Aviso de sesión iniciada visible');
  assert.equal(await js('location.pathname'), '/cuenta', 'Vuelve a la sección que pidió entrar');
  await has('Datos personales');
  assert.equal(await js('document.querySelector(".toaster").getAttribute("role")'), 'status', 'Aviso en región de estado');
  await shot('02-cuenta-con-sesion');
  await inspectAccessibility('Mi cuenta');
  checks.push('Acceso desde /cuenta: aviso «Sesión iniciada, Ana.» visible tras cerrar el diálogo y la misma ruta muestra la cuenta');

  // 3. Menú de cuenta: teclado, Escape devuelve el foco, enlaces reales con aria-current.
  await click('.account-menu .header-action');
  assert.equal(await js('document.querySelector(".account-menu .header-action").getAttribute("aria-expanded")'), 'true');
  assert.equal(await js('document.querySelector("#menu-cuenta").hidden'), false);
  assert.equal(await js('document.querySelector("#menu-cuenta a[aria-current=page]")?.getAttribute("href")'), '/cuenta');
  await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await waitFor(() => js('document.querySelector("#menu-cuenta").hidden'), 'Menú cerrado con Escape');
  assert(await js('document.activeElement===document.querySelector(".account-menu .header-action")'), 'Foco de vuelta al botón');
  await click('.account-menu .header-action');
  await click('#menu-cuenta a[href="/cuenta/direcciones"]');
  await has('Todavía no tienes direcciones');
  assert.equal(await js('location.pathname'), '/cuenta/direcciones');
  assert.equal(await js('document.querySelector("#menu-cuenta").hidden'), true, 'El menú se cierra al navegar');
  assert.equal(await js('document.querySelector(".account-nav a[aria-current=page]").textContent.trim()'), 'Direcciones');
  checks.push('Menú de cuenta: abre, Escape lo cierra y devuelve el foco, navega sin recargar y marca la sección actual');

  // CU06 a. Datos personales: Editar lleva el foco al formulario; error de celular con foco; guardado confirmado.
  await go('/cuenta');
  await has('Datos personales');
  await clickText('.account-card .btn-sm', 'Editar');
  await waitFor(async () => (await focusedId()) === 'contact-name', 'Foco en el nombre al editar');
  await fill('#contact-phone', '12345');
  await click('.account-form .btn-primary');
  await waitFor(async () => (await focusedId()) === 'contact-phone', 'Foco en el celular inválido');
  assert(await js('document.querySelector("#contact-phone").getAttribute("aria-describedby").includes("contact-phone-error")'), 'Error asociado al campo');
  await fill('#contact-phone', '+593 99 123 4567');
  await click('.account-form .btn-primary');
  await has('Guardamos tus datos.');
  await has('0991234567');
  assert(await js('document.activeElement?.getAttribute("aria-label")==="Editar datos personales"'), 'Foco de vuelta a Editar');
  checks.push('Datos personales: foco al editar, error de celular asociado y enfocado, +593 normalizado y foco de vuelta a Editar');

  // CU06 b. Conflicto entre pestañas: otra pestaña guarda; esta conserva lo escrito y pide revisar.
  const tokenA = await js('localStorage.getItem("rawenergy-token")');
  const { myProfile: remote } = await gql('{myProfile{revision}}', {}, tokenA);
  await clickText('.account-card .btn-sm', 'Editar');
  await waitFor(async () => (await focusedId()) === 'contact-name', 'Formulario abierto');
  await fill('#contact-altPhone', '0987654321');
  await gql('mutation($i:CustomerContactInput!,$r:Int!){updateMyContact(input:$i,revision:$r){revision}}', { i: { name: 'Ana Revisión', phone: '0991234567', altPhone: '0981112233' }, r: remote.revision }, tokenA);
  await click('.account-form .btn-primary');
  await has('Tus datos cambiaron en otra pestaña o dispositivo');
  assert.equal(await js('document.querySelector("#contact-altPhone").value'), '0987654321', 'Lo escrito se conserva');
  await click('.account-form .btn-primary');
  await has('Guardamos tus datos.');
  await has('0987654321');
  checks.push('Conflicto de revisión: aviso, lo escrito se conserva y el segundo guardado aplica sobre la versión actual');

  // CU06 c. Factura: cédula inválida rechazada en el navegador; válida con cero inicial guardada.
  await clickText('.account-card .btn-sm', 'Agregar');
  await fill('#billing-idNumber', '0926687857');
  await click('.account-form .btn-primary');
  await waitFor(async () => (await focusedId()) === 'billing-idNumber', 'Foco en la cédula inválida');
  await fill('#billing-idNumber', '0926687856');
  await click('.account-form .btn-primary');
  await has('Guardamos tus datos de factura.');
  await has('0926687856');
  checks.push('Factura: cédula con dígito verificador incorrecto rechazada; válida con cero inicial guardada');

  // CU06 d. Direcciones: primera predeterminada, provincia y cantón dependientes, duplicado sin copia.
  await go('/cuenta/direcciones');
  await has('Todavía no tienes direcciones');
  await clickText('.address-book .btn-primary', 'Agregar dirección');
  await fill('#address-new-label', 'Casa');
  await choose('#address-new-province', 'Pichincha');
  assert(await js('!document.querySelector("#address-new-city").disabled'), 'Cantones disponibles tras elegir provincia');
  await choose('#address-new-city', 'Quito');
  await fill('#address-new-address', 'Av. Amazonas N24-100 y Colón');
  await click('.account-form .btn-primary');
  await has('Usaremos esta dirección para tus próximas compras.');
  await clickText('.address-book .btn-primary', 'Agregar dirección');
  await fill('#address-new-label', 'Oficina');
  await choose('#address-new-province', 'Guayas');
  await choose('#address-new-city', 'Guayaquil');
  await fill('#address-new-address', 'Av. 9 de Octubre 100 y Malecón');
  await check('La recibe otra persona');
  await fill('#address-new-recipientName', 'Luis Pérez');
  await fill('#address-new-recipientPhone', '0981234567');
  await click('.account-form .btn-primary');
  await has('Dirección agregada.');
  await clickText('.address-book .btn-primary', 'Agregar dirección');
  await fill('#address-new-label', 'Casa otra vez');
  await choose('#address-new-province', 'Pichincha');
  await choose('#address-new-city', 'Quito');
  await fill('#address-new-address', 'av. amazonas n24-100 y colón');
  await click('.account-form .btn-primary');
  await has('no la duplicamos');
  assert.equal(await js('document.querySelectorAll(".address-list > li").length'), 2, 'Sin dirección duplicada');
  await shot('04-direcciones');
  checks.push('Direcciones: la primera queda predeterminada, cantón dependiente de la provincia, destinatario distinto y duplicado detectado sin copia');

  // CU06 e. Cambiar predeterminada y borrar la predeterminada eligiendo explícitamente la siguiente.
  await click('button[aria-label="Usar Oficina como predeterminada"]');
  await has('Usaremos «Oficina» para tus próximas compras.');
  await click('button[aria-label="Eliminar Oficina"]');
  assert(await js('!!document.querySelector(".remove-confirm select")'), 'Pide elegir la siguiente predeterminada');
  assert(await js('document.activeElement?.textContent?.trim()==="Eliminar"'), 'Foco en la confirmación');
  await choose('.remove-confirm select', '');
  await clickText('.remove-confirm .btn-danger', 'Eliminar');
  await has('Eliminamos «Oficina»');
  assert.equal(await js('document.querySelectorAll(".address-list .badge").length'), 0, 'Sin predeterminada por elección explícita');
  checks.push('Predeterminada: cambio confirmado; borrar la predeterminada exige elegir otra o ninguna y respeta «Ninguna»');
  await inspectAccessibility('Direcciones');

  // CU06 f. Seguridad: cambio de correo con contraseña y lista de sesiones.
  await go('/cuenta/seguridad');
  await has('Sesiones abiertas');
  await has('Este dispositivo');
  await fill('#security-email', `nuevo-${Date.now()}@example.test`);
  await fill('#security-password', 'Clave-incorrecta-1');
  await clickText('.account-form .btn-primary', 'Enviar enlace de confirmación');
  await waitFor(async () => (await focusedId()) === 'security-password', 'Contraseña incorrecta enfocada');
  await fill('#security-password', password);
  await clickText('.account-form .btn-primary', 'Enviar enlace de confirmación');
  await has('Tu correo de acceso sigue siendo');
  await inspectAccessibility('Seguridad');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  for (const path of ['/cuenta', '/cuenta/direcciones', '/cuenta/seguridad']) { await go(path); await waitFor(() => js('!!document.querySelector(".account-card")'), path); assert(await js('document.documentElement.scrollWidth<=innerWidth'), `Sin desbordamiento a 360 px: ${path}`); }
  await shot('05-cuenta-movil');
  await inspectAccessibility('Cuenta a 360 px');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  checks.push('Seguridad: contraseña incorrecta enfocada, cambio de correo pendiente sin cambiar el vigente, sesiones listadas; 360 px sin desbordamiento en las tres secciones');

  // 4. Mis pedidos como página y detalle sin acceso por número ajeno.
  await go('/mis-pedidos');
  await has('Todavía no tienes pedidos');
  await inspectAccessibility('Mis pedidos');
  await go('/mis-pedidos/RE-000000-AAAAA');
  await has('No encontramos ese pedido en tu cuenta');
  await go('/cuenta/admin');
  await has('No encontramos esta página');
  checks.push('Mis pedidos como página; un número ajeno o inexistente no muestra datos; secciones inventadas dan 404');

  // 5. Móvil 360 px: sin desbordamiento y mismos destinos en el menú.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await go('/cuenta');
  await has('Datos personales');
  assert(await js('document.documentElement.scrollWidth<=innerWidth'), 'Sin desbordamiento a 360 px');
  await click('.menu-toggle');
  await waitFor(() => js('document.querySelector(".mobile-menu-layer").classList.contains("is-open")'), 'Menú móvil');
  for (const href of ['/cuenta', '/cuenta/direcciones', '/mis-pedidos']) assert(await js(`!!document.querySelector('#menu-movil a[href="${href}"]')`), `Menú móvil: ${href}`);
  await shot('03-menu-movil');
  await click('#menu-movil a[href="/mis-pedidos"]');
  await has('Todavía no tienes pedidos');
  assert(await js('!document.querySelector(".mobile-menu-layer").classList.contains("is-open")'), 'El menú móvil se cierra al navegar');
  checks.push('360 px: sin desbordamiento; menú móvil con Mi cuenta, Direcciones y Mis pedidos, y se cierra al navegar');

  // 6. Cerrar sesión: revoca en el servidor y la sección vuelve a pedir acceso.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await go('/cuenta');
  await has('Datos personales');
  const session = await js('localStorage.getItem("rawenergy-token")');
  assert((await gql('{me{email}}', {}, session)).me?.email === email, 'Sesión válida antes de salir');
  await click('.account-menu .header-action');
  await clickText('#menu-cuenta button', 'Cerrar sesión');
  await has('Entra a tu cuenta para ver esta sección');
  await waitFor(() => js('localStorage.getItem("rawenergy-token")===null'), 'Token local borrado');
  assert.equal((await gql('{me{email}}', {}, session)).me, null, 'La sesión quedó revocada en el servidor');
  checks.push('Cerrar sesión: token local borrado, sesión revocada en el servidor y la sección vuelve a pedir acceso');

  // CU06 g. Cerrar todas las sesiones desde Seguridad.
  await go('/cuenta/seguridad');
  await has('Entra a tu cuenta para ver esta sección');
  await click('.status-page .btn-primary');
  await waitFor(() => js('!!document.querySelector("#auth-email")'), 'Diálogo de acceso');
  await fill('#auth-email', email); await fill('#auth-password', password);
  await click('.auth-card .btn-block');
  await has('Sesiones abiertas');
  const before = await js('localStorage.getItem("rawenergy-token")');
  await clickText('.account-card .btn-outline', 'Cerrar todas las sesiones');
  await has('Entra a tu cuenta para ver esta sección');
  assert.equal((await gql('{me{email}}', {}, before)).me, null, 'Todas las sesiones revocadas');
  checks.push('Cerrar todas las sesiones: revocadas en el servidor y la página vuelve a pedir acceso');

  assert.deepEqual(exceptions, []);
  await writeFile(join(out, 'report.json'), JSON.stringify({ ok: true, checks, accessibility, caveats: ['API en memoria, build de producción local, Chrome sin interfaz; no sustituye lector de pantalla real ni dispositivo físico'] }, null, 2));
  console.log(JSON.stringify({ ok: true, artifacts: out, checks }, null, 2));
} catch (error) {
  if (inspect) try { await writeFile(join(out, 'screen.txt'), await inspect()); } catch {}
  await writeFile(join(out, 'failure.log'), `${error.stack}\n${logs.join('').slice(-12000)}`); console.error(error.message); console.error(`Diagnóstico: ${out}`); process.exitCode = 1;
} finally { socket?.close(); for (const child of processes.reverse()) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); } }
