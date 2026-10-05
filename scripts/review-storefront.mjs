// Revisión aislada: API en memoria, sin correo/Telegram, build temporal y perfil nuevo.
// node scripts/review-storefront.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('.');
const out = await mkdtemp(join(tmpdir(), 'rawenergy-store-review-'));
const apiPort = 14851, uiPort = 14852, debugPort = 14853;
const api = `http://127.0.0.1:${apiPort}`, ui = `http://127.0.0.1:${uiPort}`;
const env = { PATH: process.env.PATH, NODE_ENV: 'development', DOTENV_CONFIG_PATH: '/dev/null', PORT: String(apiPort), CORS_ORIGINS: ui, PUBLIC_API_URL: api, AUTH_TOKEN_SECRET: 'isolated-storefront-review-secret-123456', ADMIN_EMAIL: 'review@example.com', ADMIN_PASSWORD: 'Review-only-123!', ADMIN_NAME: 'Revisión', VITE_GRAPHQL_URL: `${api}/graphql`, FREE_SHIPPING_THRESHOLD: '95', GRAPHQL_RATE_LIMIT_PER_MINUTE: '400', MAX_PENDING_ORDERS_PER_CUSTOMER: '20', BANK_NAME: 'Banco ficticio de prueba', BANK_ACCOUNT_TYPE: 'Ahorros', BANK_ACCOUNT_NUMBER: '0000000000', BANK_HOLDER: 'Tienda de prueba', STORE_WHATSAPP: '593983368127' };
const processes = [], logs = [], exceptions = [], checks = [], accessibility = [];
let socket, inspect;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const launch = (command, args, options = {}) => {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...options });
  processes.push(child); child.stdout.on('data', data => logs.push(String(data))); child.stderr.on('data', data => logs.push(String(data))); child.on('error', error => logs.push(error.message)); return child;
};
async function waitFor(fn, label) { let last; for (let i = 0; i < 120; i++) { try { const value = await fn(); if (value) return value; } catch (error) { last = error; } await delay(150); } throw new Error(`Timeout: ${label} ${last?.message ?? ''}`); }
async function gql(query, variables = {}, token = '') { const response = await fetch(`${api}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) }); const result = await response.json(); if (result.errors) throw new Error(result.errors.map(error => error.message).join('; ')); return result.data; }
try {
  for (const port of [apiPort, uiPort, debugPort]) { let occupied = false; try { await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) }); occupied = true; } catch {} assert(!occupied, `Puerto ${port} ocupado`); }
  const build = launch(process.execPath, ['node_modules/vite/bin/vite.js', 'build', 'apps/web', '--outDir', join(out, 'dist')], { env: { ...env, NODE_ENV: 'production' } });
  assert.equal(await new Promise(resolve => build.on('exit', resolve)), 0, 'Build temporal');
  launch(process.execPath, ['--import', 'tsx', 'apps/api/src/server.ts']);
  launch(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', 'apps/web', '--outDir', join(out, 'dist'), '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort']);
  await waitFor(async () => (await fetch(`${api}/health`)).ok, 'API'); await waitFor(async () => (await fetch(ui)).ok, 'Tienda');
  const { login: { token } } = await gql('mutation($input:LoginInput!){login(input:$input){token}}', { input: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } });
  // Fixture de galería y agotado. Imágenes del repositorio; no sustituye revisión de fotos comerciales.
  const payload = { title: 'Producto de revisión', brand: 'Marca de revisión', slug: 'producto-revision', shortDescription: 'Presentación de prueba para revisar la selección de sabor y fotografías.', productType: 'SUPPLEMENT', nutritionalFacts: { servingSize: '30 g', calories: 100, protein: 20, carbohydrates: 3, fats: 1 }, categories: [{ name: 'Prueba', slug: 'prueba' }], goals: [{ name: 'Desarrollo muscular', slug: 'desarrollo-muscular' }], featured: false, variants: [
    { sku: 'REV-AGOTADO', flavor: 'Chocolate agotado', size: { value: 300, unit: 'g' }, price: 20, stock: 0, images: [{ url: `/assets/brands/raw-nutrition.png`, alt: 'Foto de prueba' }] },
    { sku: 'REV-DISPONIBLE', flavor: 'Vainilla disponible', size: { value: 300, unit: 'g' }, price: 25, stock: 5, images: [{ url: `/assets/brands/raw-nutrition.png`, alt: 'Primera foto de prueba' }, { url: `/assets/brands/evogen.png`, alt: 'Segunda foto de prueba' }] }
  ] };
  await gql('mutation($payload:JSON!){upsertProduct(payload:$payload){id}}', { payload }, token);
  const catalogTotal = (await gql('{searchProducts(pagination:{first:1}){totalCount}}')).searchProducts.totalCount;
  assert(catalogTotal > 20 && catalogTotal <= 24, `Catálogo inicial + fixture en una página: ${catalogTotal}`);
  launch(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(out, 'profile')}`, 'about:blank'], { env: { ...env, HOME: process.env.HOME } });
  const tabs = await waitFor(async () => { const items = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json(); return items.length && items; }, 'Chrome');
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let serial = 0;
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); } if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text); });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method}`)); }, 20000); pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } }); socket.send(JSON.stringify({ id, method, params })); });
  const js = async expression => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'JS error'); return result.result.value; };
  const click = selector => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('No existe '+${JSON.stringify(selector)});e.focus();e.click();return true})()`);
  const fill = (selector, value) => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('No existe campo');Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  const inspectAccessibility = async label => {
    const tree = await cdp('Accessibility.getFullAXTree');
    const controls = tree.nodes.filter(node => !node.ignored && ['button', 'textbox', 'combobox', 'checkbox', 'radio', 'link'].includes(node.role?.value));
    const unnamed = controls.filter(node => !node.name?.value?.trim()).map(node => ({ role: node.role.value, backendDOMNodeId: node.backendDOMNodeId }));
    accessibility.push({ label, controls: controls.length, unnamed });
    assert.deepEqual(unnamed, [], `Controles sin nombre accesible: ${label}`);
    assert(await js('!document.querySelector("img:not([alt])")'), `Imagen sin alt: ${label}`);
  };
  const has = text => waitFor(() => js(`document.body.innerText.includes(${JSON.stringify(text)})`), text);
  const shot = async name => { await delay(200); const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(out, `${name}.png`), Buffer.from(result.data, 'base64')); };
  inspect = async () => { await shot('failure'); return js('location.href+"\\n"+document.body.innerText+JSON.stringify({focus:document.activeElement?.tagName+"."+document.activeElement?.className,hasFocus:document.hasFocus(),inert:document.querySelector(".store-content").inert})'); };
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable'); await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  // Fotos externas bloqueadas para que las pruebas sean reproducibles sin servicios externos.
  await cdp('Network.setBlockedURLs', { urls: ['https://*'] });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.reviewMetrics={};new PerformanceObserver(list=>{window.reviewMetrics.lcp=list.getEntries().at(-1).startTime}).observe({type:'largest-contentful-paint',buffered:true});` });
  const cardCount = () => js('document.querySelectorAll(".product-grid .card").length');
  const graphqlRequests = () => js(`performance.getEntriesByType("resource").filter(r=>r.name.includes("/graphql")).length`);
  const start = Date.now(); await cdp('Page.navigate', { url: ui }); await waitFor(() => js('document.querySelectorAll(".rail-track .card").length>0'), 'Portada con productos');
  const homeReadyMs = Date.now() - start;
  await shot('01-portada-desktop'); await inspectAccessibility('Portada');
  const metrics = await js('({ ...window.reviewMetrics, navigation:performance.getEntriesByType("navigation")[0].toJSON(), resources:performance.getEntriesByType("resource").map(r=>({name:r.name,duration:r.duration,bytes:r.transferSize})) })');
  assert(await js('document.documentElement.scrollWidth<=innerWidth'), 'Desbordamiento desktop');
  assert(await js('(()=>{const r=document.querySelector(".promo-peek").getBoundingClientRect();return r.left<innerWidth&&r.right>innerWidth})()'), 'Siguiente tarjeta parcial');
  await waitFor(() => js('document.querySelector(".promo-strip").textContent.includes("95")'), 'Umbral 95'); checks.push('Umbral de envío desde servidor: 95 USD en la cabecera');
  assert.equal(await js('document.querySelectorAll("h1").length'), 1, 'Un h1 por vista');
  const firstTitle = await js('document.querySelector(".promo-copy h2").textContent');
  await delay(8100); assert.notEqual(await js('document.querySelector(".promo-copy h2").textContent'), firstTitle, 'Avance 8 segundos');
  await js('document.querySelector(".promo-copy a").focus()'); await has('En pausa');
  const pausedTitle = await js('document.querySelector(".promo-copy h2").textContent'); await delay(8200); assert.equal(await js('document.querySelector(".promo-copy h2").textContent'), pausedTitle, 'Pausa por foco');
  checks.push('Carrusel: avance 8s, pausa por foco y siguiente tarjeta parcial');
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await cdp('Page.reload'); await has('En pausa'); checks.push('Movimiento reducido inicia pausado');

  // Campañas (C12): el carrusel muestra campañas vigentes con productos reales y cada una tiene su página.
  assert(await js('document.querySelectorAll(".promo-collage a[href^=\\"/producto/\\"]").length>0'), 'Carrusel con productos reales de la campaña');
  await cdp('Page.navigate', { url: `${ui}/campana/encuentra-tu-suplemento` }); await waitFor(() => js('document.querySelector("h1")?.textContent==="Encuentra tu suplemento en minutos" && document.querySelectorAll(".product-grid .card").length>0'), 'Página de campaña');
  assert(await js('document.title.includes("Encuentra tu suplemento") && document.querySelector(\'meta[name="description"]\').content.includes("Compara precios")'), 'Título y descripción de la campaña');
  await shot('02b-campana-desktop'); await inspectAccessibility('Página de campaña');
  await cdp('Page.navigate', { url: `${ui}/campana/no-existe` }); await has('Esta campaña ya no está disponible');
  await cdp('Page.navigate', { url: ui }); await waitFor(() => js('document.querySelectorAll(".rail-track .card").length>0'), 'Portada de nuevo');
  checks.push('Campañas: carrusel con productos reales, página propia con título y descripción, campaña inexistente');

  // Rutas: catálogo propio, filtros en la URL, recarga, Atrás/Adelante y enlaces inexistentes.
  await click('.shop-nav a[href="/catalogo"]'); await waitFor(async () => await cardCount() === catalogTotal, 'Catálogo completo');
  assert(await js('location.pathname==="/catalogo" && document.activeElement.tagName==="H1"'), 'Navegar mueve el foco al título de la vista');
  await shot('02-catalogo-desktop'); await inspectAccessibility('Catálogo y filtros');
  await cdp('Page.navigate', { url: `${ui}/catalogo?marca=Dymatize` }); await waitFor(async () => await cardCount() === 2, 'Filtro de marca desde la URL');
  assert(await js('document.querySelector(".product-grid").textContent.includes("ISO100")'));
  await click('.chips .chip'); await waitFor(async () => await cardCount() === catalogTotal, 'Quitar filtro con su chip');
  assert(await js('location.search===""'), 'La URL refleja el filtro quitado');
  checks.push('Catálogo como vista propia, filtros en la URL y chips reversibles');
  const before = await graphqlRequests();
  for (const label of ['Dymatize', 'Evogen', 'Nutrex']) await js(`[...document.querySelectorAll(".filters .check")].find(e=>e.textContent.includes(${JSON.stringify(label)})).querySelector("input").click()`);
  await waitFor(async () => await cardCount() === 6, 'Tres marcas marcadas en ráfaga'); await delay(600);
  assert((await graphqlRequests()) - before <= 1, 'Casillas en ráfaga generan una sola consulta');
  assert(await js('new URLSearchParams(location.search).getAll("marca").length===3'));
  await js('[...document.querySelectorAll(".chips .btn-link")].find(e=>e.textContent.includes("Limpiar")).click()'); await waitFor(async () => await cardCount() === catalogTotal, 'Limpiar filtros');
  checks.push('Tres casillas en ráfaga: una consulta y URL compartible');

  await fill('#buscar', 'Producto de revisión'); await click('.header-search-submit'); await waitFor(async () => await cardCount() === 1, 'Buscar fixture');
  assert(await js('new URLSearchParams(location.search).get("q")==="Producto de revisión"'));
  await click('.product-grid .card .btn'); await waitFor(() => js('!!document.querySelector(".buy-box h1")'), 'Ficha del producto');
  assert(await js('location.pathname==="/producto/producto-revision" && document.title.includes("Producto de revisión")'), 'URL y título propios');
  const structured = await js('JSON.parse(document.querySelector(\'script[type="application/ld+json"]\').textContent)');
  assert.equal(structured.name, 'Producto de revisión'); assert.equal(structured.offers.lowPrice, 20); assert.equal(structured.offers.availability, 'https://schema.org/InStock');
  assert(await js('document.querySelector(\'meta[name="description"]\').content.startsWith("Presentación de prueba")'), 'Descripción propia de la ficha');
  assert(await js('document.querySelector(".options legend b").textContent.includes("Vainilla disponible")'), 'Prefiere variante disponible');
  await has('Foto 1 de 2'); await click('[aria-label="Foto siguiente"]'); await has('Foto 2 de 2');
  await click('.gallery-main'); await waitFor(() => js('!!document.querySelector(".lightbox")'), 'Ampliación de fotos');
  assert(await js('document.querySelector(".store-content").inert'), 'Fondo inerte con la ampliación abierta');
  await click('.lightbox [aria-label="Ampliar"]'); await has('150 %');
  await js('document.querySelector(".lightbox [aria-label=\\"Foto siguiente\\"]").focus()');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert(await js('!!document.activeElement.closest(".lightbox")'), 'Tab permanece en la ampliación');
  await shot('03-ampliacion-desktop'); await inspectAccessibility('Ampliación de fotos');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(() => js('!document.querySelector(".lightbox")'), 'Escape cierra la ampliación');
  await waitFor(() => js('document.activeElement.classList.contains("gallery-main")'), 'Foco vuelve a la foto');
  checks.push('Galería: flechas, ampliación con zoom, Tab contenido, Escape y retorno del foco');
  await shot('04-producto-desktop'); await inspectAccessibility('Ficha, variantes y galería');
  await js('[...document.querySelectorAll(".option")].find(e=>e.textContent.includes("Chocolate agotado")).querySelector("input").click()');
  assert(await js('document.querySelector(".purchase .add-to-cart").disabled'), 'Agotado bloqueado');
  await js('[...document.querySelectorAll(".option")].find(e=>e.textContent.includes("Vainilla disponible")).querySelector("input").click()');
  await js('for (let i=0;i<5;i++) document.querySelector(".purchase .add-to-cart").click()');
  await waitFor(() => js('document.querySelector(".cart-icon b")?.textContent==="1"'), 'Cinco clics seguidos agregan una unidad'); await delay(400);
  assert.equal(await js('document.querySelector(".cart-icon b").textContent'), '1', 'Un solo disparo');
  await has('Agregaste 1 × Producto de revisión'); assert(await js('!document.querySelector(".cart-drawer").classList.contains("is-open")'), 'Agregar no interrumpe la navegación');
  checks.push('Cinco clics rápidos en Agregar: una unidad y aviso no bloqueante');
  await js('history.back()'); await waitFor(async () => await cardCount() === 1 && await js('new URLSearchParams(location.search).get("q")==="Producto de revisión"'), 'Atrás vuelve a la búsqueda');
  await js('history.forward()'); await waitFor(() => js('!!document.querySelector(".buy-box h1")'), 'Adelante vuelve a la ficha');
  await cdp('Page.reload'); await waitFor(() => js('document.querySelector(".buy-box h1")?.textContent==="Producto de revisión"'), 'Recargar la ficha');
  await cdp('Page.navigate', { url: `${ui}/producto/no-existe` }); await has('Este producto no está disponible');
  await cdp('Page.navigate', { url: `${ui}/pagina-inventada` }); await has('No encontramos esta página');
  checks.push('Atrás/Adelante, recarga de ficha, producto inexistente, ruta desconocida y datos estructurados de producto');

  await cdp('Page.navigate', { url: `${ui}/producto/producto-revision` }); await waitFor(() => js('!!document.querySelector(".buy-box h1")'), 'Ficha');
  await click('.cart-button'); await has('Tu carrito'); await inspectAccessibility('Carrito');
  await click('.cart-line .stepper button:last-child'); await waitFor(() => js('document.querySelector(".cart-line output").textContent==="2"'), 'Aumentar');
  await click('.cart-line .stepper button:first-child'); await waitFor(() => js('document.querySelector(".cart-line output").textContent==="1"'), 'Disminuir');
  await cdp('Page.reload'); await waitFor(() => js('document.querySelector(".cart-icon b")?.textContent==="1"'), 'Carrito restaurado tras recargar');
  await click('.cart-button'); await has('Carrito recuperado');
  await click('.drawer-foot .checkout'); await has('Datos de entrega');
  await waitFor(() => js('!document.querySelector(".drawer-foot .checkout").disabled'), 'Total calculado por el servidor');
  await click('.drawer-foot .checkout'); await waitFor(() => js('document.querySelectorAll(".checkout-form [aria-invalid=true]").length>0'), 'Errores de campos vacíos');
  await waitFor(() => js('document.querySelector("input[name=idNumber]").getAttribute("aria-invalid")==="true"'), 'Cédula obligatoria marcada');
  checks.push('Carrito persistente, aumentar/disminuir cantidad y campos obligatorios');
  // Datos validados (C32): celular 09, correo con sugerencia de tipeo y dominio que recibe correo, cédula con dígito verificador.
  await fill('input[name=fullName]', 'Cliente de revisión'); await fill('input[name=phone]', '12345'); await fill('input[name=address]', 'Calle de prueba 123');
  await fill('input[name=email]', 'cliente@gmial.com'); await js('document.querySelector("input[name=email]").focus(); document.querySelector("input[name=address]").focus()');
  await has('¿Quisiste decir'); await click('.email-suggestion button');
  await waitFor(() => js('document.querySelector("input[name=email]").value==="cliente@gmail.com"'), 'Sugerencia de correo aplicada');
  await fill('input[name=email]', 'cliente@example.com'); await js('document.querySelector("input[name=email]").focus(); document.querySelector("input[name=address]").focus()');
  await has('no recibe correos');
  await fill('input[name=email]', 'cliente.revision@gmail.com');
  await fill('input[name=idNumber]', ''); await fill('input[name=phone]', '0999999999'); await click('.drawer-foot .checkout'); await has('la necesitamos para la factura'); await fill('input[name=phone]', '12345');
  // Verificador de cédula (C35): responde al completar los 10 dígitos, sin salir del campo.
  await fill('input[name=idNumber]', '1700000002'); await has('La cédula no es válida');
  await fill('input[name=idNumber]', '1700000001'); await has('Cédula válida');
  assert(await js('document.querySelector("input[name=fullName]").value==="Cliente de revisión"'), 'Sin consulta externa: el nombre no cambia');
  checks.push('Verificador de cédula al escribir: inválida avisada y válida confirmada, sin consulta externa');
  await click('.drawer-foot .checkout'); await has('10 dígitos que empieza con 09');
  await fill('input[name=phone]', '+593 99 999 9999'); await js('document.querySelector("input[name=phone]").focus(); document.querySelector("input[name=address]").focus()');
  await waitFor(() => js('document.querySelector("input[name=phone]").value==="0999999999"'), 'Celular normalizado desde +593');
  checks.push('Datos validados: celular 09 (normaliza +593), correo con sugerencia de tipeo y dominio sin correo rechazado (example.com, MX nulo), cédula con dígito verificador');
  // Provincias y cantones de Ecuador (C32); express solo en Quito y Rumiñahui.
  assert.equal(await js('document.querySelectorAll("select[name=province] option:not([disabled])").length'), 24, '24 provincias');
  assert.equal(await js('document.querySelectorAll("select[name=city] option:not([disabled])").length'), 8, '8 cantones de Pichincha');
  await fill('select[name=city]', 'Cayambe'); await waitFor(() => js('document.querySelector("input[name=shippingMethod]").disabled'), 'Cayambe sin express');
  await fill('select[name=city]', 'Rumiñahui'); await waitFor(() => js('!document.querySelector("input[name=shippingMethod]").disabled'), 'Sangolquí con express');
  await fill('select[name=city]', 'Quito'); await click('input[name=shippingMethod]');
  checks.push('Provincia y ciudad en listas (24 provincias, cantones por provincia); express solo en Quito y Rumiñahui');
  await waitFor(() => js('!document.querySelector(".drawer-foot .checkout").disabled'), 'Total confirmado');
  await waitFor(() => js('document.querySelector(".checkout-summary-total").textContent.includes("29,00")'), '25 + 4 de envío');
  assert(await js('!document.querySelectorAll("input[name=paymentMethod]")[1].disabled'), 'Contra entrega sin mínimo con 25 USD');
  await fill('select[name=province]', 'Guayas'); await fill('select[name=city]', 'Guayaquil');
  await waitFor(() => js('document.querySelector("input[name=shippingMethod]").disabled'), 'Express incompatible bloqueado');
  await waitFor(() => js('document.querySelector(".checkout-summary-total").textContent.includes("30,00")'), 'Envío nacional 5 USD');
  await fill('select[name=province]', 'Pichincha'); await click('input[name=shippingMethod]');
  await waitFor(() => js('document.querySelector(".checkout-summary-total").textContent.includes("29,00")'), 'Express restaurado');
  await fill('input[name=fullName]', '          '); await click('.drawer-foot .checkout'); await has('Escribe tu nombre completo para la entrega');
  await fill('input[name=fullName]', 'Cliente de revisión');
  await inspectAccessibility('Checkout y ayudas');
  await shot('05-checkout-desktop');
  await waitFor(() => js('!document.querySelector(".drawer-foot .checkout").disabled'), 'Confirmación habilitada');
  await js('for (let i=0;i<4;i++) document.querySelector(".drawer-foot .checkout").click()');
  await has('Continúa por WhatsApp para recibir los datos de pago'); await inspectAccessibility('Confirmación y cierre por WhatsApp');
  assert(await js('!document.querySelector(".bank-instructions") && !document.body.innerText.includes("Banco ficticio")'), 'La web no muestra la cuenta: se da por WhatsApp');
  assert(await js('location.origin===' + JSON.stringify(ui)), 'Confirmar no redirige a otra página');
  await shot('06-confirmacion-transferencia');
  checks.push('Espacios rechazados, envío compatible y confirmación sin datos bancarios en la web (se piden por WhatsApp)');
  const { orders: connection } = await gql('{orders{orders{items{variantSku quantity} total}}}', {}, token);
  const orders = connection.orders;
  assert.equal(orders.length, 1, 'Cuatro clics en Confirmar crean un solo pedido'); assert.equal(orders[0].items[0].variantSku, 'REV-DISPONIBLE'); assert.equal(orders[0].total, 29);
  checks.push('Galería; agotado bloqueado; cuatro clics en Confirmar: un pedido de la variante elegida por 29 USD');
  // Cierre por WhatsApp (C30) y reserva de 24 h (C17): el mensaje lleva el pedido completo.
  const orderNumber = await js('document.querySelector(".order-success .eyebrow").textContent.replace("Pedido ","").trim()');
  const message = await js(`(()=>{const a=document.querySelector('.order-success a.whatsapp-continue[href^="https://wa.me/593983368127"]');return a&&a.target==="_blank"?new URL(a.href).searchParams.get("text"):null})()`);
  assert(message, 'Botón «Continuar mi compra por WhatsApp» al chat de la tienda');
  for (const part of [`Pedido ${orderNumber}`, '1 × Producto de revisión', 'Total: $29,00', 'Express Quito y Valles', 'envíenme los datos para transferir', 'Celular: 0999999999', 'Quito, Pichincha', 'Identificación para la factura: Cédula 1700000001']) assert(message.includes(part), `Mensaje de WhatsApp incluye «${part}»`);
  await has('Continuar mi compra por WhatsApp'); await has('Paga antes del');
  checks.push('Cierre: «Continuar mi compra por WhatsApp» con pedido, productos, totales, entrega, celular y cédula; hora límite de la reserva de 24 h');
  await js('[...document.querySelectorAll(".order-success button")].find(b=>b.textContent.includes("Seguir comprando")).click()');
  // Consulta de pedido para invitados (C18).
  await cdp('Page.navigate', { url: `${ui}/pedido?numero=${encodeURIComponent(orderNumber)}` }); await has('Consulta tu pedido');
  await fill('.track-form input[autocomplete=email]', 'otra@gmail.com'); await click('.track-form button'); await has('No encontramos un pedido con esos datos');
  await fill('.track-form input[autocomplete=email]', 'cliente.revision@gmail.com'); await click('.track-form button'); await has('Esperando tu transferencia'); await has('Reservamos tus productos hasta');
  await has('Continuar mi compra por WhatsApp'); assert(await js('!document.body.innerText.includes("Datos para la transferencia")'), 'Consulta sin cuenta bancaria en la web');
  assert(await js('!document.body.innerText.includes("Calle de prueba 123")'), 'La consulta no muestra la dirección');
  await shot('06b-consulta-pedido'); await inspectAccessibility('Consulta de pedido');
  checks.push('Consulta de pedido: contacto incorrecto rechazado, estado y reserva visibles, sin dirección');
  // Pedido repetido (C26, P02): mismos productos en menos de 30 min desde este navegador → aviso antes de crear otro.
  await cdp('Page.navigate', { url: `${ui}/producto/producto-revision` }); await waitFor(() => js('!!document.querySelector(".buy-box h1")'), 'Ficha para repetir');
  await click('.purchase .buy-now'); await has('Datos de entrega');
  await fill('input[name=fullName]', 'Cliente de revisión'); await fill('input[name=phone]', '0999999999'); await fill('input[name=email]', 'cliente.revision@gmail.com'); await fill('input[name=idNumber]', '1700000001'); await fill('select[name=province]', 'Pichincha'); await fill('select[name=city]', 'Quito'); await fill('input[name=address]', 'Calle de prueba 123');
  await waitFor(() => js('!document.querySelector(".drawer-foot .checkout").disabled'), 'Total para repetir');
  await click('.drawer-foot .checkout'); await has('Hace menos de 30 minutos registraste el pedido');
  await waitFor(() => js(`document.activeElement?.classList.contains("repeat-order") && document.querySelector(".repeat-order a").getAttribute("href").includes(${JSON.stringify(encodeURIComponent(orderNumber))})`), 'Aviso enfocado con enlace al pedido anterior');
  await inspectAccessibility('Aviso de pedido repetido'); await shot('06d-aviso-pedido-repetido');
  assert.equal((await gql('{orders{orders{id}}}', {}, token)).orders.orders.length, 1, 'El aviso no crea otro pedido');
  await click('.checkout-back'); await click('.cart-line-remove'); await has('Tu carrito está vacío'); await click('.drawer-head .icon-btn');
  checks.push('Mismo pedido otra vez en menos de 30 min: aviso enfocado con enlace al anterior y sin crear otro');
  // Políticas legales (C16) y nutrición no declarada (C14).
  for (const [path, title, text] of [['privacidad', 'Política de privacidad', 'Superintendencia de Protección de Datos Personales'], ['devoluciones', 'Política de cambios y devoluciones', 'no aceptamos cambios ni devoluciones'], ['terminos', 'Términos y condiciones', '24 horas'], ['envios', 'Envíos y pagos', 'Servientrega']]) {
    await cdp('Page.navigate', { url: `${ui}/legal/${path}` }); await waitFor(() => js(`document.querySelector("h1")?.textContent===${JSON.stringify(title)}`), title); await has(text);
  }
  assert(await js('!document.body.innerText.includes("RUC")'), 'Sin RUC configurado no se inventa');
  await shot('06c-legal-envios');
  await cdp('Page.navigate', { url: `${ui}/producto/dragon-pharma-creatine-monohydrate` }); await has('La etiqueta no declara energía');
  await cdp('Page.navigate', { url: `${ui}/producto/dragon-pharma-iso-phorm` }); await has('No declarado'); await has('110 kcal');
  await cdp('Page.navigate', { url: ui }); await waitFor(() => js('document.querySelectorAll(".rail-track .card").length>0'), 'Portada tras legales');
  checks.push('Políticas legales sin datos inventados y nutrición «No declarado» cuando la etiqueta no lo informa');

  await click('.header-actions > .header-action'); await has('Entrar a mi cuenta');
  await fill('.auth-card input[type=email]', 'unknown@example.test'); await fill('.auth-card input[type=password]', 'wrong-password'); await click('.auth-card .btn-primary'); await waitFor(() => js('!!document.querySelector(".auth-card .notice-error")'), 'Credenciales inválidas explicadas');
  await inspectAccessibility('Acceso con error'); await click('.auth-card .modal-close');
  checks.push('Acceso fallido conserva pantalla, anuncia error y no deja excepción sin controlar');

  await fill('#buscar', 'zzzzsinproducto'); await click('.header-search-submit'); await has('No encontramos productos'); await click('.empty-state .btn-primary');
  await waitFor(async () => await cardCount() === catalogTotal, 'Limpiar búsqueda');
  await fill('.sort select', 'PRICE_ASC'); await waitFor(() => js('new URLSearchParams(location.search).get("orden")==="menor-precio"'), 'Orden en la URL'); await delay(500);
  const prices = await js('[...document.querySelectorAll(".product-grid .card-price strong")].map(e=>Number(e.textContent.replace(/[^0-9,]/g,"").replace(",",".")))');
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b)); checks.push('Búsqueda vacía recuperable y orden global');
  await fill('.price-filter input[name=min]', '70'); await fill('.price-filter input[name=max]', '40'); await click('.price-filter button'); await has('El mínimo debe ser menor');
  await fill('.price-filter input[name=max]', '80'); await click('.price-filter button');
  await waitFor(async () => await cardCount() === 1, 'Filtro de precio');
  assert(await js('document.querySelector(".product-grid").textContent.includes("Levro Whey Supreme")'));
  await js('[...document.querySelectorAll(".chips .btn-link")].find(e=>e.textContent.includes("Limpiar")).click()'); await waitFor(async () => await cardCount() === catalogTotal, 'Limpiar precio');
  checks.push('Precio inválido explicado y filtro 70–80 USD correcto');
  // P08 (C25): la presentación agotada de 20 USD no define el «desde» ni entra en el filtro.
  await cdp('Page.navigate', { url: `${ui}/catalogo?q=${encodeURIComponent('Producto de revisión')}` }); await waitFor(async () => await cardCount() === 1, 'Producto de revisión en el catálogo');
  assert(await js('(()=>{const t=document.querySelector(".product-grid .card").innerText;return t.includes("25,00")&&!t.includes("20,00")&&!t.includes("Desde")})()'), 'Tarjeta sin el precio de la presentación agotada');
  await cdp('Page.navigate', { url: `${ui}/catalogo?min=19&max=21` }); await waitFor(() => js('!!document.querySelector(".product-grid .card, .empty-state")'), 'Filtro 19–21');
  assert(await js('!document.querySelector(".product-grid")?.innerText.includes("Producto de revisión")'), 'Filtro de precio ignora la presentación agotada');
  checks.push('Precio «desde» y filtro sin presentaciones agotadas');

  await cdp('Page.navigate', { url: `${ui}/catalogo` }); await waitFor(async () => await cardCount() === catalogTotal, 'Catálogo');
  const quick = await js('[...document.querySelectorAll(".product-grid .card")].findIndex(card=>card.querySelector(".btn-primary"))');
  await js(`for (let i=0;i<6;i++) document.querySelectorAll(".product-grid .card")[${quick}].querySelector(".btn-primary").click()`);
  await waitFor(() => js('document.querySelector(".cart-icon b")?.textContent==="1"'), 'Seis clics en Agregar de tarjeta'); await delay(400);
  assert.equal(await js('document.querySelector(".cart-icon b").textContent'), '1', 'Tarjeta de un solo disparo');
  await click('.toast .btn-primary'); await has('Tu carrito'); await click('.cart-line-remove'); await has('Tu carrito está vacío'); await click('.drawer-head .icon-btn');
  checks.push('Seis clics rápidos en Agregar de una tarjeta: una unidad');
  // Carrito en dos pestañas (C26, P03): otra pestaña guarda sin que su aviso llegue a esta; el siguiente cambio aquí la conserva.
  await js(`localStorage.setItem("rawenergy-cart-v1", JSON.stringify({ version: 1, expiresAt: Date.now() + 3600000, items: [{ productId: "otra-pestana", variantSku: "OTRA-1", title: "Producto de otra pestaña", variantLabel: "1 kg", unitPrice: 10, quantity: 1, vitalCoinsReward: 0 }] }))`);
  await waitFor(() => js(`document.querySelectorAll(".product-grid .card")[${quick}].querySelector(".btn-primary").getAttribute("aria-disabled")==="false"`), 'Fin del bloqueo anti doble clic');
  await js(`document.querySelectorAll(".product-grid .card")[${quick}].querySelector(".btn-primary").click()`);
  await waitFor(() => js('document.querySelector(".cart-icon b")?.textContent==="2"'), 'Carrito conserva lo de la otra pestaña');
  await click('.cart-button'); await has('Producto de otra pestaña'); await has('otra pestaña');
  await click('.cart-line-remove'); await waitFor(() => js('document.querySelectorAll(".cart-line").length===1'), 'Quitar primera línea');
  await click('.cart-line-remove'); await has('Tu carrito está vacío'); await click('.drawer-head .icon-btn');
  checks.push('Dos pestañas: un cambio aquí conserva lo que otra pestaña guardó aunque su aviso no llegara');

  await cdp('Page.navigate', { url: `${ui}/producto/producto-revision` }); await waitFor(() => js('!!document.querySelector(".buy-box h1")'), 'Ficha');
  await click('.purchase .buy-now'); await has('Datos de entrega'); assert(await js('!!document.querySelector("#checkout-form")'), 'Comprar ahora abre la entrega');
  await click('.checkout-back'); await click('.cart-line-remove'); await click('.drawer-head .icon-btn');
  checks.push('Comprar ahora lleva directo al paso de entrega');

  // Límite de peticiones simulado: la tienda explica la espera en lugar de un fallo de conexión.
  await cdp('Fetch.enable', { patterns: [{ urlPattern: `${api}/graphql*`, requestStage: 'Request' }] });
  const limitedBody = Buffer.from(JSON.stringify({ errors: [{ message: 'Demasiadas solicitudes seguidas. Espera un minuto y vuelve a intentarlo.', extensions: { code: 'RATE_LIMITED', retryAfter: 60 } }] })).toString('base64');
  const intercept = event => { const message = JSON.parse(event.data); if (message.method === 'Fetch.requestPaused') { const { requestId, request } = message.params; if (request.method === 'OPTIONS') cdp('Fetch.continueRequest', { requestId }).catch(() => {}); else cdp('Fetch.fulfillRequest', { requestId, responseCode: 429, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: ui }], body: limitedBody }).catch(() => {}); } };
  socket.addEventListener('message', intercept);
  await cdp('Page.navigate', { url: `${ui}/catalogo?q=limite` }); await has('Demasiadas solicitudes seguidas');
  await shot('07-limite-peticiones');
  socket.removeEventListener('message', intercept); await cdp('Fetch.disable');
  checks.push('Respuesta 429 simulada: mensaje de espera y botón para reintentar');

  for (const width of [390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp('Page.navigate', { url: ui }); await waitFor(() => js('document.querySelectorAll(".rail-track .card").length>0'), `Portada ${width}`); await delay(400);
    assert(await js('document.documentElement.scrollWidth<=innerWidth'), `Desbordamiento móvil ${width}`);
    await click('.menu-toggle'); assert(await js('document.querySelector(".menu-toggle").getAttribute("aria-expanded")==="true"')); await click('.menu-toggle'); await shot(`08-portada-${width}`);
    await cdp('Page.navigate', { url: `${ui}/catalogo` }); await waitFor(async () => await cardCount() === catalogTotal, `Catálogo ${width}`); await delay(300);
    assert(await js('document.documentElement.scrollWidth<=innerWidth'), `Desbordamiento catálogo ${width}`);
    await shot(`09-catalogo-${width}`);
    assert.equal(await js('getComputedStyle(document.querySelector(".filters")).display'), 'none');
    await click('.filters-open'); assert.notEqual(await js('getComputedStyle(document.querySelector(".filters")).display'), 'none');
    assert(await js('document.querySelector(".filters").getAttribute("role")==="dialog"'), 'Hoja de filtros como diálogo');
    await click('.filters-close'); await waitFor(() => js('document.activeElement.classList.contains("filters-open")'), 'Foco vuelve al botón de filtros');
  }
  checks.push('Móvil 390/320 sin desbordamiento, menú y hoja de filtros con foco');
  await cdp('Page.navigate', { url: `${ui}/producto/producto-revision` }); await waitFor(() => js('!!document.querySelector(".buy-box h1")'), 'Ficha móvil'); await delay(300);
  await shot('10-producto-mobile');
  assert(await js('document.documentElement.scrollWidth<=innerWidth'), 'Ficha móvil sin desbordamiento');
  // Desde C54 la barra fija aparece al pasar el bloque de compra (no al abrir la ficha).
  assert(await js('document.querySelector(".mobile-buy-bar").classList.contains("is-hidden")'), 'Barra fija oculta al abrir la ficha');
  await js('window.scrollTo(0, document.querySelector(".purchase").getBoundingClientRect().bottom + scrollY + 40)'); await delay(400);
  assert(await js('(()=>{const bar=document.querySelector(".mobile-buy-bar");const r=bar.getBoundingClientRect();return !bar.classList.contains("is-hidden")&&r.top>=0&&r.bottom<=innerHeight&&bar.textContent.includes("$")})()'), 'Precio y compra visibles en móvil al pasar el bloque de compra');
  await js('window.scrollTo(0, 0)'); await delay(200);
  await click('.mobile-buy-bar button'); await has('Agregaste'); await click('.cart-button'); await click('.drawer-foot .checkout'); await has('Datos de entrega');
  assert(await js('(()=>{const f=document.querySelector(".checkout-form");return f.scrollWidth<=f.clientWidth+1})()'), 'Formulario de entrega sin desbordamiento horizontal');
  await shot('11-checkout-mobile'); await inspectAccessibility('Checkout móvil');
  await click('.drawer-head .icon-btn'); await click('.cart-button'); await click('.checkout-back'); await click('.cart-line-remove'); await has('Tu carrito está vacío'); await click('.drawer-head .icon-btn');
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await shot('12-alto-contraste');
  await js('localStorage.setItem("rawenergy-cart-v1", "{broken")'); await cdp('Page.reload'); await waitFor(() => js('document.querySelector(".cart-icon b")?.textContent==="0"'), 'Carrito corrupto descartado');
  await click('.cart-button'); await has('No pudimos recuperar');
  checks.push('Eliminar producto, menú móvil, colores forzados y almacenamiento corrupto sin caída');
  // Contra entrega (C20): solo express y subtotal de más de 75 USD; el servidor repite la regla.
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await cdp('Emulation.setEmulatedMedia', { features: [] }); await click('.drawer-head .icon-btn');
  await cdp('Page.navigate', { url: `${ui}/producto/producto-revision` }); await waitFor(() => js('!!document.querySelector(".buy-box h1")'), 'Ficha contra entrega');
  await has('Transferencia bancaria o contra entrega'); await has('No aceptamos cambios ni devoluciones por preferencia');
  await click('.purchase .buy-now'); await has('Datos de entrega'); await click('.checkout-back');
  for (const n of ['2', '3', '4']) { await click('.cart-line .stepper button:last-child'); await waitFor(() => js(`document.querySelector(".cart-line output").textContent===${JSON.stringify(n)}`), `Cantidad ${n}`); }
  await click('.drawer-foot .checkout'); await has('Datos de entrega');
  await fill('input[name=fullName]', 'Cliente contra entrega'); await fill('input[name=phone]', '0988888888'); await fill('input[name=email]', 'cod.revision@gmail.com'); await fill('select[name=idType]', 'PASAPORTE'); await fill('input[name=idNumber]', 'AB123456'); await fill('select[name=province]', 'Pichincha'); await fill('select[name=city]', 'Quito'); await fill('input[name=address]', 'Calle de prueba 456');
  const codRadio = 'document.querySelectorAll("input[name=paymentMethod]")[1]';
  // 100 USD: express gratis (umbral 95 en la revisión); contra entrega sin mínimo.
  await waitFor(() => js(`document.querySelector(".checkout-summary-total").textContent.includes("100,00") && !${codRadio}.disabled`), 'Express gratis y contra entrega disponible');
  await js(`${codRadio}.click()`); await has('Pagas el total al recibir');
  await fill('select[name=province]', 'Guayas'); await fill('select[name=city]', 'Guayaquil');
  await waitFor(() => js(`${codRadio}.disabled && document.querySelectorAll("input[name=paymentMethod]")[0].checked`), 'Fuera de Quito vuelve a transferencia');
  await has('Solo con envío express en Quito y Valles');
  await waitFor(() => js('document.querySelector(".checkout-summary-total").textContent.includes("105,00")'), 'Nacional cobra 5 USD aunque pase el umbral: el gratis es solo express');
  await fill('select[name=province]', 'Pichincha'); await click('input[name=shippingMethod]');
  await waitFor(() => js(`!${codRadio}.disabled`), 'Express de nuevo'); await js(`${codRadio}.click()`);
  await inspectAccessibility('Checkout contra entrega'); await js('document.querySelector(".payment-options").scrollIntoView({block:"center"})'); await shot('13-checkout-contra-entrega');
  await waitFor(() => js('!document.querySelector(".drawer-foot .checkout").disabled'), 'Confirmar contra entrega');
  await js('for (let i=0;i<3;i++) document.querySelector(".drawer-foot .checkout").click()');
  await has('Confírmalo por WhatsApp y envíanos tu ubicación'); await has('Total a pagar al recibir'); await has('Confírmalo por WhatsApp antes del');
  assert(await js('!document.querySelector(".order-success .bank-instructions") && !document.body.innerText.includes("Paga antes del")'), 'Contra entrega sin datos bancarios ni plazo de reserva');
  const codMessage = await js('new URL(document.querySelector(".order-success a.whatsapp-continue").href).searchParams.get("text")');
  assert(codMessage.includes('contra entrega') && codMessage.includes('4 × Producto de revisión') && codMessage.includes('Total: $100,00'), 'Contra entrega también continúa por WhatsApp con el pedido');
  assert(codMessage.includes('Identificación para la factura: Pasaporte AB123456'), 'Extranjero con pasaporte, sin verificación');
  assert(codMessage.includes('Confirmo mi pedido y les envío mi ubicación'), 'El mensaje confirma el pedido y anuncia la ubicación');
  await shot('14-confirmacion-contra-entrega');
  const codOrders = (await gql('{orders{orders{paymentMethod total shippingFee status}}}', {}, token)).orders.orders.filter(order => order.paymentMethod === 'CASH_ON_DELIVERY');
  assert.deepEqual(codOrders, [{ paymentMethod: 'CASH_ON_DELIVERY', total: 100, shippingFee: 0, status: 'PENDING_PAYMENT' }], 'Un pedido contra entrega de 100 USD');
  checks.push('Contra entrega: confirmación por WhatsApp con ubicación y plazo visible (C36); sin mínimo; express gratis desde el umbral, nacional siempre 5 USD; fuera de Quito vuelve a transferencia; tres clics, un pedido');
  // Límite real de /graphql (C28): el 429 lleva CORS y la tienda pide esperar en lugar de decir «sin conexión».
  const { register: { token: customerToken } } = await gql('mutation($input:RegisterInput!){register(input:$input){token}}', { input: { name: 'Cliente con cuenta', email: `limite-${Date.now()}@example.com`, password: 'Cliente-123!' } });
  let limited;
  for (let i = 0; i < 900 && !limited; i++) { const response = await fetch(`${api}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ui }, body: '{"query":"{checkoutInfo{whatsapp}}"}' }); if (response.status === 429) limited = response; else await response.arrayBuffer(); }
  assert(limited, 'El límite de /graphql responde 429');
  assert.equal(limited.headers.get('access-control-allow-origin'), ui, '429 con cabecera CORS');
  const status = async auth => (await fetch(`${api}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}` }, body: '{"query":"{checkoutInfo{whatsapp}}"}' })).status;
  assert.equal(await status(token), 200, 'El personal con sesión sigue operando');
  assert.equal(await status(customerToken), 429, 'Un cliente con sesión sigue sujeto al límite');
  await cdp('Page.navigate', { url: `${ui}/catalogo?q=limite-real` }); await has('Demasiadas solicitudes seguidas');
  assert(await js('!document.body.innerText.includes("No hay conexión")'), 'Límite real no se confunde con falta de conexión');
  await shot('15-limite-real');
  checks.push('Límite real de /graphql alcanzado: 429 con CORS, la tienda pide esperar, el personal sigue operando y un cliente con sesión no');
  assert.deepEqual(exceptions, []);
  await writeFile(join(out, 'report.json'), JSON.stringify({ ok: true, checks, accessibility, homeReadyMs, metrics, caveats: ['API demo local, build producción, caché fría inicial, sin throttling', 'Límite de /graphql elevado a 400/min por IP para el recorrido automatizado; producción usa 120 salvo que se configure', 'Fotos externas bloqueadas; no mide carga de fotos reales ni p75 producción', 'Datos y pedidos de prueba solo en memoria'] }, null, 2));
  console.log(JSON.stringify({ ok: true, artifacts: out, homeReadyMs, lcp: metrics.lcp, checks }));
} catch (error) {
  if (inspect) try { await writeFile(join(out, 'screen.txt'), await inspect()); } catch {}
  await writeFile(join(out, 'failure.log'), `${error.stack}\n${logs.join('').slice(-12000)}`); console.error(error.message); console.error(`Diagnóstico: ${out}`); process.exitCode = 1;
} finally { socket?.close(); for (const child of processes.reverse()) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); } }
