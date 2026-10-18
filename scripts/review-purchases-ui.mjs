// IMPL-BASE-01: recorrido aislado del panel para compras con factura (M05), clave de operación (M35)
// y recepción con fecha real (M40). Datos en memoria, sin SMTP/Telegram, perfil temporal de Chrome.
// No lee .env ni toca la base real. Uso desde la raíz: node scripts/review-purchases-ui.mjs
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('.');const out=await mkdtemp(join(tmpdir(),'rawenergy-purchases-ui-'));
const apiPort=14851,uiPort=14852,debugPort=14853;
const api=`http://127.0.0.1:${apiPort}`,ui=`http://127.0.0.1:${uiPort}`;
const env={PATH:process.env.PATH,NODE_ENV:'development',DOTENV_CONFIG_PATH:'/dev/null',PORT:String(apiPort),PUBLIC_API_URL:api,AUTH_TOKEN_SECRET:'isolated-purchases-review-secret-123456789',ADMIN_EMAIL:'compras@example.com',ADMIN_PASSWORD:'Review-only-123!',ADMIN_NAME:'Equipo de prueba',VITE_GRAPHQL_URL:`${api}/graphql`,VITE_WEB_URL:'http://localhost:5173'};
const processes=[];const logs=[];let socket;let inspect;
const launch=(command,args,options={})=>{const child=spawn(command,args,{cwd:root,env,stdio:['ignore','pipe','pipe'],...options});processes.push(child);child.stdout.on('data',d=>logs.push(String(d)));child.stderr.on('data',d=>logs.push(String(d)));return child;};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,label){let last;for(let i=0;i<100;i++){try{const value=await fn();if(value)return value;}catch(e){last=e;}await delay(150);}throw new Error(`Timeout: ${label}${last?` (${last.message})`:''}`);}
let token='';
async function gql(query,variables={}){const r=await fetch(`${api}/graphql`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({query,variables})});const body=await r.json();if(body.errors)throw new Error(body.errors[0].message);return body.data;}
const ec=(days=0)=>new Date(Date.now()-5*3600000-days*86400000).toISOString().slice(0,10);
const checks=[];const ok=t=>{checks.push(t);console.log(`✓ ${t}`);};
try{
 for(const port of [apiPort,uiPort,debugPort]){let occupied=false;try{await fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(500)});occupied=true;}catch{}assert(!occupied,`El puerto ${port} ya está ocupado`);}
 launch(process.execPath,['--import','tsx','apps/api/src/server.ts']);
 launch(process.execPath,['node_modules/vite/bin/vite.js','apps/admin','--host','127.0.0.1','--port',String(uiPort),'--strictPort']);
 await waitFor(async()=>(await fetch(`${api}/health`)).ok,'API demo');await waitFor(async()=>(await fetch(ui)).ok,'Panel');
 token=(await gql('mutation($input:LoginInput!){login(input:$input){token}}',{input:{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD}})).login.token;
 await gql('mutation{saveSupplier(input:{name:"Proveedor con RUC",taxId:"1793213242001",leadDays:3})}');
 const product=(await gql('{searchProducts(pagination:{first:1}){edges{node{id title variants{sku}}}}}')).searchProducts.edges[0].node;
 const chrome=process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 launch(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${join(out,'profile')}`,'--window-size=1440,1000','about:blank'],{env:{...env,HOME:process.env.HOME}});
 const tabs=await waitFor(async()=>{const r=await fetch(`http://127.0.0.1:${debugPort}/json`);const t=await r.json();return t.length?t:null;},'Chrome');
 socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 const pending=new Map();let serial=0;const exceptions=[];
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const task=pending.get(m.id);pending.delete(m.id);m.error?task.reject(new Error(m.error.message)):task.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`));},20000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
 const js=async(expression)=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??'JavaScript error');return r.result.value;};
 const click=async(text,selector='button')=>js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getClientRects().length);if(!e)throw new Error(${JSON.stringify('No encontrado: '+text)});e.click();return true;})()`);
 // Rellena el control asociado a una etiqueta visible: también comprueba que cada campo tenga nombre accesible.
 const fillLabel=async(label,value,nth=0)=>js(`(()=>{const l=[...document.querySelectorAll('label')].filter(l=>l.getClientRects().length&&l.childNodes[0]?.textContent?.trim()===${JSON.stringify(label)})[${nth}];const e=l?.querySelector('input,select,textarea');if(!e)throw new Error(${JSON.stringify('Campo no encontrado: '+label)});const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
 const has=async(text)=>waitFor(()=>js(`document.body.innerText.includes(${JSON.stringify(text)})`),text);
 const shot=async(name)=>{await delay(250);const r=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(out,`${name}.png`),Buffer.from(r.data,'base64'));};
 inspect=async()=>{await shot('failure');return js('document.body.innerText');};
 await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Network.setBlockedURLs',{urls:['https://*']}).catch(()=>{});
 await cdp('Page.navigate',{url:ui});await has('Iniciar sesión');
 await js(`(()=>{for(const [s,v] of [['input[type=email]',${JSON.stringify(env.ADMIN_EMAIL)}],['input[type=password]',${JSON.stringify(env.ADMIN_PASSWORD)}]]){const e=document.querySelector(s);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));}return true;})()`);
 await click('Entrar al panel');await has('Buen día');
 await click('Proveedores','.sidebar nav button');await has('RUC 1793213242001');ok('La lista de proveedores muestra el RUC guardado');

 // Compra con factura: un error de la línea se explica y no se guarda.
 await click('Órdenes de compra','.sidebar nav button');await has('Órdenes de compra');await click('Nueva compra');await has('Agregar productos');
 const supplierOption=await js(`[...document.querySelectorAll('option')].find(o=>o.textContent.startsWith('Proveedor con RUC')).value`);
 await fillLabel('Proveedor',supplierOption);
 await js(`(()=>{const box=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Registrar con los datos de la factura')).querySelector('input');box.click();return true;})()`);
 await has('Factura del proveedor');
 assert.equal(await js(`[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('RUC del proveedor')).querySelector('input').value`),'1793213242001');
 ok('Al activar la factura se propone el RUC del proveedor elegido');
 await fillLabel('Número de factura','002-100-000007777');await fillLabel('Fecha de emisión',ec(2));await fillLabel('Subtotal sin IVA','87,03');await fillLabel('IVA','13,05');await fillLabel('Total de la factura','100,08');
 await fillLabel('Agregar productos',product.variants[0].sku);
 await waitFor(()=>js(`[...document.querySelectorAll('.product-picker button')].length>0`),'resultado de búsqueda');
 await js(`document.querySelector('.product-picker button').click()`);await has('Unitario sin IVA');
 await fillLabel('Cantidad','4');await fillLabel('Unitario sin IVA','21,756521');await fillLabel('Total línea sin IVA','87,04');await fillLabel('Lote (opcional)','REV-FACT');await fillLabel('Vencimiento','2090-01-01');
 await shot('01-factura-escritorio');
 await click('Guardar borrador');await has('Línea 1: 4 × 21.756521 = 87.026084, pero el total de la línea es 87.04');
 ok('Una línea que no cuadra muestra qué revisar y no se guarda');
 await fillLabel('Total línea sin IVA','87,03');await click('Guardar borrador');await has('Borrador de compra guardado.');
 const saved=(await gql('{supplyOverview}')).supplyOverview.purchases.find(p=>p.document?.number==='002-100-000007777');
 assert(saved);assert.equal(saved.total,100.08);assert.equal(saved.items[0].unitCost,25.02);assert.equal(saved.items[0].taxAllocated,'13.05');assert(saved.requestKey);
 ok('La compra guarda la factura, el total impreso 100,08, el costo con IVA 25,02 y su clave de operación');
 await has('Factura 002-100-000007777');
 await js(`(()=>{const row=[...document.querySelectorAll('tr')].find(r=>r.textContent.includes('Factura 002-100-000007777'));[...row.querySelectorAll('button')].find(b=>b.textContent==='Editar').click();return true;})()`);
 await has('Costo con IVA:');await shot('02-costo-con-iva');ok('Al abrir el borrador se ve el costo con IVA por unidad y el IVA asignado');
 await click('Cerrar');
 await assert.rejects(gql('mutation($input:JSON!){savePurchase(input:$input)}',{input:{supplierId:saved.supplierId,warehouseId:'main',document:{supplierTaxId:'1793213242001',number:'002-100-000007777',issuedOn:ec(2),subtotal:'87.03',tax:'13.05',total:'100.08'},items:[{productId:product.id,sku:product.variants[0].sku,quantity:4,netUnitCost:'21.756521',netTotal:'87.03',lot:'X',expiresOn:'2090-01-01'}]}}),/ya está registrada/);
 ok('La API rechaza registrar otra vez la misma factura');

 // Recepción con fecha real.
 await js(`(()=>{const row=[...document.querySelectorAll('tr')].find(r=>r.textContent.includes('Factura 002-100-000007777'));[...row.querySelectorAll('button')].find(b=>b.textContent==='Confirmar compra').click();return true;})()`);
 await waitFor(()=>js(`[...document.querySelectorAll('[role=dialog] button, dialog button')].some(b=>b.textContent.trim()==='Confirmar')`),'diálogo de confirmación');
 await js(`[...document.querySelectorAll('[role=dialog] button, dialog button')].find(b=>b.textContent.trim()==='Confirmar').click()`);
 await has('Compra actualizada.');
 await js(`(()=>{const row=[...document.querySelectorAll('tr')].find(r=>r.textContent.includes('Factura 002-100-000007777'));[...row.querySelectorAll('button')].find(b=>b.textContent==='Recibir').click();return true;})()`);
 await has('Fecha real de recepción');
 assert.equal(await js(`[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Fecha real de recepción')).querySelector('input').value`),ec(0));
 await fillLabel('Fecha real de recepción',ec(3));await shot('03-recepcion');await click('Confirmar recepción');await has('Recepción registrada.');
 await click('Bodegas y lotes','.sidebar nav button');await has('Existencias por lote');
 const row=await js(`[...document.querySelectorAll('tr')].find(r=>r.textContent.includes('REV-FACT'))?.innerText`);
 assert(row?.includes(ec(3)),`fila sin fecha de recepción: ${row}`);
 ok('La recepción usa la fecha real indicada y Bodegas y lotes la muestra en la columna Recibido');

 // Pantalla de teléfono: el formulario de factura no provoca desplazamiento horizontal.
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
 await click('Abrir menú').catch(()=>{});await delay(300);
 await js(`(()=>{const b=[...document.querySelectorAll('.sidebar nav button')].find(b=>b.textContent.trim()==='Órdenes de compra');b.click();return true;})()`);await has('Nueva compra');await click('Nueva compra');
 await js(`(()=>{const box=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Registrar con los datos de la factura')).querySelector('input');box.click();return true;})()`);await has('Factura del proveedor');
 const overflow=await js('document.documentElement.scrollWidth-window.innerWidth');await shot('04-factura-telefono');
 assert(overflow<=1,`desplazamiento horizontal de ${overflow}px`);ok('A 390 px de ancho el formulario de factura no se desborda');
 const unlabeled=await js(`[...document.querySelectorAll('form input:not([type=hidden]),form select')].filter(e=>e.getClientRects().length&&!e.closest('label')&&!e.getAttribute('aria-label')).length`);
 assert.equal(unlabeled,0);ok('Todos los campos visibles del formulario tienen etiqueta');
 assert.deepEqual(exceptions,[]);
 await writeFile(join(out,'report.json'),JSON.stringify({ok:true,checks,limits:['Chrome sin interfaz en macOS, datos en memoria; no prueba lectores de pantalla, Windows ni producción']},null,2));
 console.log(JSON.stringify({ok:true,artifacts:out,checks:checks.length}));
}catch(error){if(inspect)try{await writeFile(join(out,'screen.txt'),await inspect());}catch{}console.error(error.message);await writeFile(join(out,'failure.log'),`${error.stack}\n\n${logs.join('').slice(-12000)}`);console.error(`Diagnóstico: ${out}`);process.exitCode=1;}
finally{socket?.close();for(const child of processes.reverse())child.kill('SIGTERM');}
