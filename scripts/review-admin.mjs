// Isolated browser smoke test: memory data, no SMTP/Telegram, temporary Chrome profile.
// Run from the repository root with: node scripts/review-admin.mjs
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const root=resolve('.');const out=await mkdtemp(join(tmpdir(),'rawenergy-admin-review-'));
const apiPort=14841,uiPort=14842,debugPort=14843;
const api=`http://127.0.0.1:${apiPort}`,ui=`http://127.0.0.1:${uiPort}`;
const env={PATH:process.env.PATH,NODE_ENV:'development',DOTENV_CONFIG_PATH:'/dev/null',PORT:String(apiPort),PUBLIC_API_URL:api,AUTH_TOKEN_SECRET:'isolated-browser-review-secret-123456789',ADMIN_EMAIL:'review@example.com',ADMIN_PASSWORD:'Review-only-123!',ADMIN_NAME:'Equipo de prueba',VITE_GRAPHQL_URL:`${api}/graphql`,VITE_WEB_URL:'http://localhost:5173'};
const processes=[];const logs=[];let socket;let inspect;
const launch=(command,args,options={})=>{const child=spawn(command,args,{cwd:root,env,stdio:['ignore','pipe','pipe'],...options});processes.push(child);child.stdout.on('data',d=>logs.push(String(d)));child.stderr.on('data',d=>logs.push(String(d)));child.on('error',e=>logs.push(e.message));return child;};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,label){let last;for(let i=0;i<100;i++){try{const value=await fn();if(value)return value;}catch(e){last=e;}await delay(150);}throw new Error(`Timeout: ${label}${last?` (${last.message})`:''}`);}
let token='';
async function gql(query,variables={}){const response=await fetch(`${api}/graphql`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({query,variables})});const body=await response.json();if(body.errors)throw new Error(body.errors.map(e=>e.message).join('; '));return body.data;}
try{
 for(const port of [apiPort,uiPort,debugPort]){let occupied=false;try{await fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(500)});occupied=true;}catch{}assert(!occupied,`El puerto ${port} ya está ocupado; no se usará otro proceso.`);}
 launch(process.execPath,['--import','tsx','apps/api/src/server.ts']);
 launch(process.execPath,['node_modules/vite/bin/vite.js','apps/admin','--host','127.0.0.1','--port',String(uiPort),'--strictPort']);
 await waitFor(async()=>{const r=await fetch(`${api}/health`);return r.ok;},'API demo');await waitFor(async()=>{const r=await fetch(ui);return r.ok;},'Admin');
 const login=await gql('mutation($input:LoginInput!){login(input:$input){token user{id name email role status}}}',{input:{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD}});token=login.login.token;
 const supplier=(await gql('mutation{saveSupplier(input:{name:"Distribuidora de prueba",contact:"Equipo comercial",leadDays:7})}')).saveSupplier;
 const warehouse=(await gql('mutation{saveWarehouse(input:{name:"Bodega norte",address:"Quito"})}')).saveWarehouse;
 const catalog=(await gql('{searchProducts(pagination:{first:5}){edges{node{id title variants{sku stock}}}}}')).searchProducts.edges;
 const product=catalog[0].node;
 const purchase=(await gql('mutation($input:JSON!){savePurchase(input:$input)}',{input:{supplierId:supplier.id,warehouseId:warehouse.id,expectedOn:'2090-01-01',items:[{productId:product.id,sku:product.variants[0].sku,quantity:8,unitCost:18,lot:'REV-01',expiresOn:'2090-06-01'}]}})).savePurchase;
 await gql('mutation($id:ID!){changePurchase(id:$id,status:"ORDERED",revision:0)}',{id:purchase.id});
 await gql('mutation($id:ID!){changePurchase(id:$id,status:"RECEIVED",revision:1)}',{id:purchase.id});
 const today=new Date(Date.now()-5*3600000).toISOString().slice(0,10);
 const inSevenDays=new Date(Date.now()+7*86400000-5*3600000).toISOString().slice(0,10);
 const pendingPurchase=(await gql('mutation($input:JSON!){savePurchase(input:$input)}',{input:{supplierId:supplier.id,warehouseId:warehouse.id,expectedOn:inSevenDays,items:[{productId:product.id,sku:product.variants[0].sku,quantity:12,unitCost:18,lot:'REV-02',expiresOn:'2090-06-01'}]}})).savePurchase;
 await gql('mutation($id:ID!){changePurchase(id:$id,status:"ORDERED",revision:0)}',{id:pendingPurchase.id});
 for(const [category,amount,description] of [['ADVERTISING',35,'Campaña comercial de revisión'],['TRANSPORT',12,'Entregas a clientes de revisión']])await gql('mutation($id:ID!,$input:JSON!){saveExpense(id:$id,input:$input)}',{id:randomUUID(),input:{date:today,category,amount,description}});

 const order=(await gql('mutation($input:CheckoutInput!){createCheckoutOrder(input:$input){id}}',{input:{idempotencyKey:randomUUID(),customer:{fullName:'Cliente de prueba',email:'cliente.panel.revision@gmail.com',phone:'0999999999',province:'Pichincha',city:'Quito',address:'Dirección de prueba 123',idNumber:'1700000001'},items:[{productId:product.id,variantSku:product.variants[0].sku,quantity:2}],shippingMethod:'EXPRESS_QUITO_VALLES',paymentMethod:'BANK_TRANSFER'}})).createCheckoutOrder;
 await gql('mutation($id:ID!){updateOrderStatus(id:$id,status:PAID){id}}',{id:order.id});
 for(const role of ['CATALOG','WAREHOUSE','MANAGER'])await gql('mutation($input:JSON!){saveAccount(input:$input){id}}',{input:{name:`Perfil ${role}`,email:`${role.toLowerCase()}@example.com`,password:'Review-role-123!',role,status:'ACTIVE'}});
 const chrome=process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 launch(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${join(out,'profile')}`,'--window-size=1440,1000','about:blank'],{env:{...env,HOME:process.env.HOME}});
 const tabs=await waitFor(async()=>{const r=await fetch(`http://127.0.0.1:${debugPort}/json`);const tabs=await r.json();return tabs.length?tabs:null;},'Chrome');
 socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 const pending=new Map();let serial=0;const exceptions=[];
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const task=pending.get(m.id);pending.delete(m.id);m.error?task.reject(new Error(m.error.message)):task.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`));},20000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
 const js=async(expression)=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??'JavaScript error');return r.result.value;};
 const click=async(text,selector='button')=>js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getClientRects().length);if(!e)throw new Error(${JSON.stringify('Botón no encontrado: '+text)});e.click();return true;})()`);
 const fill=async(selector,value)=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Campo no encontrado');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
 const has=async(text)=>waitFor(()=>js(`document.body.innerText.includes(${JSON.stringify(text)})`),text);
 const shot=async(name)=>{await delay(250);const r=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(out,`${name}.png`),Buffer.from(r.data,'base64'));};
 inspect=async()=>{await shot('failure');return js('document.body.innerText');};
 await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Network.enable');await cdp('Network.setBlockedURLs',{urls:['https://*']});
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url:ui});await has('Iniciar sesión');await fill('input[type=email]',env.ADMIN_EMAIL);await fill('input[type=password]',env.ADMIN_PASSWORD);await click('Entrar al panel');await has('Buen día');await has('Productos activos');await shot('01-inicio-desktop');
 const checks=[];
 for(const [label,heading] of [['Productos','Productos'],['Categorías y marcas','Categorías'],['Fotografías','Biblioteca de imágenes'],['Pedidos','Pedidos'],['Stock y reposición','Inventario y reposición'],['Órdenes de compra','Órdenes de compra'],['Proveedores','Proveedores'],['Bodegas y lotes','Existencias por lote'],['Movimientos','Movimientos'],['Ventas y resultados','Ventas y resultados'],['Gastos del negocio','Gastos del negocio'],['Usuarios y permisos','Usuarios y cuentas'],['Auditoría','Auditoría'],['Base de datos','Gestión de colecciones'],['Configuración','Tienda y API'],['Mi acceso','Acceso y sesiones']]){
  await click(label,'.sidebar nav button');await has(heading);await delay(500);const alerts=await js(`[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent.trim()).filter(Boolean)`);assert.equal(alerts.length,0,`${label}: ${alerts}`);checks.push(label);
  if(label==='Ventas y resultados')await shot('02-gerencia-desktop');if(label==='Bodegas y lotes')await shot('03-bodegas-desktop');
 }
 await click('Ventas y resultados','.sidebar nav button');await has('Cómo cambia el negocio');await delay(700);await shot('08-resultados-desktop');
 await js('window.scrollTo(0,700)');await shot('09-resultados-detalle');
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await js('window.scrollTo(0,0)');await shot('10-resultados-mobile');assert(await js('document.documentElement.scrollWidth<=window.innerWidth+1'),'Resultados desborda en móvil');
 await js('window.scrollTo(0,900)');await shot('11-graficos-mobile');
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await click('Gastos del negocio','.sidebar nav button');await has('Registrar gasto');
 const expenseTotal=async()=>(await gql('query($filters:JSON!){expenses(filters:$filters)}',{filters:{year:Number(today.slice(0,4)),month:Number(today.slice(5,7))}})).expenses.activeAmount;
 const beforeExpense=await expenseTotal();
 await click('Registrar gasto');await has('Fecha del gasto');await fill('#expense-editor input[type=number]','18.5');await fill('#expense-editor textarea','Publicidad visual de revisión');await click('Guardar gasto');await has('Gasto guardado.');assert.equal(await expenseTotal(),beforeExpense+18.5);
 const editRow=async(label)=>{await waitFor(()=>js(`![...document.querySelectorAll('.data-table button')].some(b=>b.disabled)`),'Gastos listos');return js(`(()=>{const row=[...document.querySelectorAll('.data-table tbody tr')].find(r=>r.textContent.includes('Publicidad visual de revisión'));const button=[...row.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});button.click();})()`);};
 await editRow('Corregir');await has('Corregir gasto');await fill('#expense-editor input[type=number]','20.5');await click('Guardar gasto');await waitFor(async()=>await expenseTotal()===beforeExpense+20.5,'Corrección de gasto');await delay(400);await shot('12-gastos-desktop');
 await editRow('Anular');await has('Motivo de anulación');await fill('#expense-editor textarea','Registro duplicado de revisión');await click('Confirmar anulación');await has('Gasto anulado.');assert.equal(await expenseTotal(),beforeExpense);await waitFor(()=>js(`![...document.querySelectorAll('.data-table button')].some(b=>b.disabled)`),'Anulación terminada');
 await click('Movimientos','.sidebar nav button');await has('Recorrido de la mercancía');await delay(400);await shot('13-trazabilidad-desktop');
 // Campañas de portada (fase C, C12): sugeridas visibles, alta con vista previa, publicación y pausa.
 const live=async()=>(await gql('{activeCampaigns{slug}}')).activeCampaigns.map(c=>c.slug);
 await click('Campañas de portada','.sidebar nav button');await has('En portada ahora');await has('Vuelve a tu rutina con todo');await delay(300);await shot('14-campanas-desktop');
 await click('Nueva campaña','.admin-page button');await waitFor(()=>js(`!!document.querySelector('#campaign-editor .campaign-preview')`),'Editor de campaña');
 await fill('#campaign-editor input[placeholder="Ej. Vuelve a tu rutina con todo"]','Selección de revisión');await fill('#campaign-editor input[placeholder="Ej. Septiembre en marcha"]','Revisión');await fill('#campaign-editor textarea','Selección de prueba creada desde el panel.');
 await js(`document.querySelector('#campaign-editor .chip-options input').click()`);
 await waitFor(()=>js(`document.querySelector('.campaign-preview h3').textContent==='Selección de revisión'&&document.querySelectorAll('.campaign-preview figure').length>0`),'Vista previa con productos reales');await shot('15-campana-editor');
 await click('Guardar campaña');await has('Campaña creada.');assert((await live()).includes('seleccion-de-revision'),'La tienda publica la campaña nueva');
 await js(`(()=>{const row=[...document.querySelectorAll('.campaign-row')].find(r=>r.textContent.includes('Selección de revisión'));[...row.querySelectorAll('button')].find(b=>b.textContent.includes('Pausar')).click();})()`);
 await has('Campaña pausada');assert(!(await live()).includes('seleccion-de-revision'),'Pausada no se publica');
 // Destacados desde la lista de productos (C11).
 const featured=async()=>(await gql('{searchProducts(filters:{featured:true},pagination:{first:100}){edges{node{id}}}}')).searchProducts.edges.length;
 const beforeFeatured=await featured();
 await click('Productos','.sidebar nav button');await has('Nuevo producto');await waitFor(()=>js(`!![...document.querySelectorAll('.featured-toggle')].find(b=>b.textContent.trim()==='Destacar')`),'Estrella para destacar');
 await js(`[...document.querySelectorAll('.featured-toggle')].find(b=>b.textContent.trim()==='Destacar').click()`);await has('aparece en Destacados de la tienda');assert.equal(await featured(),beforeFeatured+1);await shot('16-destacados-desktop');
 // Pagos y envíos (C20): valores iniciales del propietario, tarifa y cuenta editables con confirmación; la tienda los recibe.
 await click('Configuración','.sidebar nav button');await has('Pagos y envíos');await has('Avisos de pedidos');await has('Sin avisos pendientes ni fallidos');await waitFor(()=>js(`document.querySelector('.commerce-panel input[inputmode=numeric]')?.value==='4755789300'`),'Cuenta inicial Banco Pichincha');
 assert(await js(`document.querySelector('.commerce-panel .commerce-card:nth-of-type(2) label:nth-of-type(2) input').value==='5'`),'Envío nacional inicial 5 USD');
 assert(await js(`!document.querySelector('.commerce-panel .commerce-card:nth-of-type(1) .switch-row input').checked && [...document.querySelectorAll('.free-methods input')].map(i=>i.checked).join()==='true,false'`),'Cuenta por WhatsApp y envío gratis solo express');
 assert.equal((await gql('{checkoutInfo{bank{accountNumber}}}')).checkoutInfo.bank,null,'La tienda no publica la cuenta por omisión');
 await js(`document.querySelector('.commerce-panel').scrollIntoView()`);await shot('17-pagos-envios');
 await fill('.commerce-panel input[inputmode=numeric]','2200112233');await fill('.commerce-panel .commerce-card:nth-of-type(2) label:nth-of-type(2) input','6');await js(`document.querySelector('.commerce-panel .commerce-card:nth-of-type(1) .switch-row input').click()`);
 await click('Guardar pagos y envíos');await has('Cambiar cuenta de cobro');await click('Sí, cambiar cuenta','dialog button');await has('Configuración guardada');
 const commerce=(await gql('{checkoutInfo{bank{accountNumber} shippingRates{method fee}}}')).checkoutInfo;
 assert.equal(commerce.bank.accountNumber,'2200112233');assert.equal(commerce.shippingRates.find(r=>r.method==='SERVIENTREGA_NATIONAL').fee,6);
 await fill('.commerce-panel input[inputmode=numeric]','4755789300');await fill('.commerce-panel .commerce-card:nth-of-type(2) label:nth-of-type(2) input','5');await js(`document.querySelector('.commerce-panel .commerce-card:nth-of-type(1) .switch-row input').click()`);
 await waitFor(()=>js(`!document.body.innerText.includes('Cambiar cuenta de cobro')`),'Diálogo cerrado');await click('Guardar pagos y envíos');await has('Cambiar cuenta de cobro');await click('Sí, cambiar cuenta','dialog button');await waitFor(async()=>(await gql('{commerceSettings}')).commerceSettings.bank.accountNumber==='4755789300','Cuenta restaurada');assert.equal((await gql('{checkoutInfo{bank{accountNumber}}}')).checkoutInfo.bank,null,'Vuelve a darse por WhatsApp');await waitFor(()=>js(`!document.querySelector('.commerce-panel fieldset').disabled&&document.body.innerText.includes('Configuración guardada')`),'Guardado terminado');
 // Contra entrega (C36): se confirma por WhatsApp desde el pedido, con ubicación; antes no puede prepararse.
 const cod=(await gql('mutation($input:CheckoutInput!){createCheckoutOrder(input:$input){id orderNumber allowedNextStatuses}}',{input:{idempotencyKey:randomUUID(),customer:{fullName:'Cliente contra entrega',email:'cod.panel.revision@gmail.com',phone:'0988888888',province:'Pichincha',city:'Quito',address:'Calle de prueba 456',idNumber:'1700000001'},items:[(()=>{const v=catalog.flatMap(e=>e.node.variants.map(x=>({productId:e.node.id,variantSku:x.sku,stock:x.stock}))).find(x=>x.stock>2);return {productId:v.productId,variantSku:v.variantSku,quantity:1};})()],shippingMethod:'EXPRESS_QUITO_VALLES',paymentMethod:'CASH_ON_DELIVERY'}})).createCheckoutOrder;
 assert.deepEqual(cod.allowedNextStatuses,['CANCELLED'],'Sin confirmar solo puede cancelarse');
 await click('Pedidos','.sidebar nav button');await has('Por confirmar por WhatsApp');
 // C74: la tienda puede abrir la conversación con el mensaje listo (celular 09… → 5939…).
 const chat=await js(`(()=>{const a=document.querySelector('.cod-pending a.cod-chat');return a&&{href:a.href,text:new URL(a.href).searchParams.get('text')};})()`);
 assert(chat&&chat.href.startsWith('https://wa.me/593988888888?text=')&&chat.text.includes(cod.orderNumber)&&chat.text.includes('contra entrega')&&chat.text.includes('ubicación'),'Escribirle por WhatsApp con el pedido');
 assert(await js(`[...document.querySelectorAll('.order-card')].filter(card=>card.textContent.includes(${JSON.stringify(cod.orderNumber)})).every(card=>!card.querySelector('.row-actions>a'))`),'Sin enlace repetido mientras está por confirmar');
 await fill('.cod-pending input','https://maps.google.com/?q=-0.1807,-78.4678');await js(`document.querySelector('.cod-pending').scrollIntoView({block:'center'})`);await shot('18-pedido-por-confirmar');
 await click('Confirmado por WhatsApp','.cod-pending button');await has('Confirmado por WhatsApp el');await has('Ver ubicación');
 assert(await js(`[...document.querySelectorAll('.order-card')].some(card=>card.textContent.includes(${JSON.stringify(cod.orderNumber)})&&card.querySelector('.row-actions>a')?.href.startsWith('https://wa.me/593988888888?text='))`),'WhatsApp del cliente tras confirmar');
 const confirmedCod=(await gql('query($id:ID!){order(id:$id){confirmedAt deliveryLocation allowedNextStatuses}}',{id:cod.id})).order;
 assert(confirmedCod.confirmedAt&&confirmedCod.deliveryLocation.includes('maps.google.com')&&confirmedCod.allowedNextStatuses.includes('PREPARING'),'Confirmado con ubicación y listo para preparar');
 await click('Productos','.sidebar nav button');await has('Nuevo producto');await click('Nuevo producto','.topbar button');await has('Carga rápida');await fill('input[placeholder="Ej. Gold Standard 100% Whey"]','Producto en borrador');await click('Inicio','.sidebar nav button');await has('Cambios sin guardar');await click('Cancelar','dialog button');assert(await js(`!!document.querySelector('.floating-actions')`));await click('Inicio','.sidebar nav button');await click('Salir del formulario','dialog button');await has('Buen día');await click('Nuevo producto','.topbar button');await has('Recuperar borrador');await click('Recuperar borrador');assert.equal(await js(`document.querySelector('input[placeholder="Ej. Gold Standard 100% Whey"]').value`),'Producto en borrador');await shot('04-editor-desktop');
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await shot('05-editor-mobile');assert(await js(`document.documentElement.scrollWidth<=window.innerWidth+1`),'El editor desborda en móvil');
 await js(`document.querySelector('[aria-label="Abrir menú"]').click()`);await click('Inicio','.sidebar nav button');await click('Salir del formulario','dialog button');await has('Buen día');await shot('06-inicio-mobile');assert(await js(`document.documentElement.scrollWidth<=window.innerWidth+1`),'Inicio desborda en móvil');
 await js(`document.querySelector('[aria-label="Abrir menú"]').click()`);await shot('07-menu-mobile');await click('Cerrar sesión','.side-bottom button');await has('Iniciar sesión');
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 for(const role of ['CATALOG','WAREHOUSE','MANAGER']){
  await fill('input[type=email]',`${role.toLowerCase()}@example.com`);await fill('input[type=password]','Review-role-123!');await click('Entrar al panel');await has('Buen día');await delay(500);
  const labels=await js(`[...document.querySelectorAll('.sidebar nav button')].map(e=>e.textContent.trim())`);assert(!labels.includes('Usuarios y permisos'));assert.equal(labels.includes('Ventas y resultados'),role==='MANAGER');assert.equal(labels.includes('Órdenes de compra'),role!=='CATALOG');assert.equal(labels.includes('Fotografías'),role==='CATALOG');assert.equal(labels.includes('Gastos del negocio'),role==='MANAGER');
  const target=role==='CATALOG'?'Fotografías':role==='WAREHOUSE'?'Stock y reposición':'Ventas y resultados';await click(target,'.sidebar nav button');await delay(600);assert.equal((await js(`[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent.trim()).filter(Boolean)`)).length,0,role);if(role==='MANAGER'){await click('Gastos del negocio','.sidebar nav button');await has('Gastos del negocio');await delay(400);assert(!await js(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Registrar gasto')`));}await click('Cerrar sesión','.side-bottom button');await has('Iniciar sesión');
 }
 assert.deepEqual(exceptions,[]);await writeFile(join(out,'report.json'),JSON.stringify({ok:true,modules:checks,profiles:['ADMIN','CATALOG','WAREHOUSE','MANAGER'],checks:['login UI','campaigns create/preview/publish/pause','featured toggle reaches store','dirty confirmation','local draft recovery','desktop/mobile overflow','role navigation','no runtime exceptions','expenses create/edit/void changes totals','business dashboard desktop/mobile','visual product timeline','commerce settings edit with bank-change confirmation reaches store','notification outbox status visible','cash on delivery confirmed by WhatsApp with location'],screenshots:18},null,2));
 console.log(JSON.stringify({ok:true,artifacts:out,modules:checks.length,profiles:4}));
}catch(error){if(inspect)try{await writeFile(join(out,'screen.txt'),await inspect());}catch{}console.error(error.message);await writeFile(join(out,'failure.log'),`${error.stack}\n\n${logs.join('').slice(-12000)}`);console.error(`Diagnóstico: ${out}`);process.exitCode=1;}
finally{socket?.close();for(const child of processes.reverse())child.kill('SIGTERM');}
