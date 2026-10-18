// ROT-01 y CMB-01: recorrido aislado de antigüedad, poca salida y cambios con proveedor. API en memoria,
// sin .env ni base real; perfil temporal de Chrome. Uso desde la raíz: node scripts/review-aging-ui.mjs
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('.');const out=await mkdtemp(join(tmpdir(),'rawenergy-aging-ui-'));
const apiPort=14881,uiPort=14882,debugPort=14883;const api=`http://127.0.0.1:${apiPort}`,ui=`http://127.0.0.1:${uiPort}`;
const env={PATH:process.env.PATH,NODE_ENV:'development',DOTENV_CONFIG_PATH:'/dev/null',PORT:String(apiPort),PUBLIC_API_URL:api,AUTH_TOKEN_SECRET:'isolated-aging-review-secret-12345678901',ADMIN_EMAIL:'antiguedad@example.com',ADMIN_PASSWORD:'Review-only-123!',ADMIN_NAME:'Equipo de prueba',VITE_GRAPHQL_URL:`${api}/graphql`,VITE_WEB_URL:'http://localhost:5173'};
const processes=[];const logs=[];let socket;let inspect;
const launch=(c,a,o={})=>{const ch=spawn(c,a,{cwd:root,env,stdio:['ignore','pipe','pipe'],...o});processes.push(ch);ch.stdout.on('data',d=>logs.push(String(d)));ch.stderr.on('data',d=>logs.push(String(d)));return ch;};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,label){let last;for(let i=0;i<120;i++){try{const v=await fn();if(v)return v;}catch(e){last=e;}await delay(150);}throw new Error(`Timeout: ${label}${last?` (${last.message})`:''}`);}
let token='';async function gql(query,variables={}){const r=await fetch(`${api}/graphql`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({query,variables})});const b=await r.json();if(b.errors)throw new Error(b.errors[0].message);return b.data;}
const ec=(d=0)=>new Date(Date.now()-5*3600000-d*86400000).toISOString().slice(0,10);
const checks=[];const ok=t=>{checks.push(t);console.log(`✓ ${t}`);};
try{
 launch(process.execPath,['--import','tsx','apps/api/src/server.ts']);
 launch(process.execPath,['node_modules/vite/bin/vite.js','apps/admin','--host','127.0.0.1','--port',String(uiPort),'--strictPort']);
 await waitFor(async()=>(await fetch(`${api}/health`)).ok,'API');await waitFor(async()=>(await fetch(ui)).ok,'Panel');
 token=(await gql('mutation($i:LoginInput!){login(input:$i){token}}',{i:{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD}})).login.token;
 const supplier=(await gql('mutation{saveSupplier(input:{name:"Proveedor de cambios",taxId:"1793213242001"})}')).saveSupplier;
 const products=(await gql('{searchProducts(pagination:{first:3}){edges{node{id title variants{sku}}}}}')).searchProducts.edges.map(e=>e.node);
 const receive=async(p,quantity,days)=>{const d=(await gql('mutation($i:JSON!){savePurchase(input:$i)}',{i:{supplierId:supplier.id,warehouseId:'main',items:[{productId:p.id,sku:p.variants[0].sku,quantity,unitCost:20,lot:'REV-ANT',expiresOn:'2090-01-01'}]}})).savePurchase;await gql('mutation($id:ID!){changePurchase(id:$id,status:"ORDERED",revision:0)}',{id:d.id});await gql('mutation($id:ID!,$r:String){changePurchase(id:$id,status:"RECEIVED",revision:1,receivedOn:$r)}',{id:d.id,r:ec(days)});};
 await receive(products[0],6,170);await receive(products[1],3,5);
 const chrome=process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 launch(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${join(out,'profile')}`,'--window-size=1440,1000','about:blank'],{env:{...env,HOME:process.env.HOME}});
 const tabs=await waitFor(async()=>{const t=await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();return t.length?t:null;},'Chrome');
 socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 const pending=new Map();let serial=0;const exceptions=[];
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const t=pending.get(m.id);pending.delete(m.id);m.error?t.reject(new Error(m.error.message)):t.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const js=async e=>{const r=await cdp('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??'JS');return r.result.value;};
 const click=(text,sel='button')=>js(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.trim().startsWith(${JSON.stringify(text)})&&b.getClientRects().length);if(!b)throw new Error(${JSON.stringify('No encontrado: '+text)});b.click();return true;})()`);
 const fillLabel=(label,value)=>js(`(()=>{const l=[...document.querySelectorAll('label')].find(l=>l.getClientRects().length&&l.textContent.trim().startsWith(${JSON.stringify(label)}));const e=l?.querySelector('input,select,textarea');if(!e)throw new Error(${JSON.stringify('Campo no encontrado: '+label)});const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
 const has=t=>waitFor(()=>js(`document.body.innerText.includes(${JSON.stringify(t)})`),t);
 const shot=async n=>{await delay(250);const r=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(out,`${n}.png`),Buffer.from(r.data,'base64'));};
 inspect=async()=>{await shot('failure');return js('document.body.innerText');};
 await cdp('Runtime.enable');await cdp('Page.enable');
 await cdp('Page.navigate',{url:ui});await has('Iniciar sesión');
 await js(`(()=>{for(const [s,v] of [['input[type=email]',${JSON.stringify(env.ADMIN_EMAIL)}],['input[type=password]',${JSON.stringify(env.ADMIN_PASSWORD)}]]){const e=document.querySelector(s);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));}return true;})()`);
 await click('Entrar al panel');await has('Buen día');
 await has('Mercadería por cambiar');await has('6 unidades');ok('Inicio muestra «Mercadería por cambiar» con las 6 unidades de la recepción antigua');
 await click('Antigüedad y cambios','.sidebar nav button');await has('Recepciones en inventario');await has('Prioritario');await has('Contactar proveedor');await shot('01-antiguedad');
 const text=await js('document.querySelector(".aging-panel").innerText');
 assert(text.includes(products[0].title)&&!text.includes(products[1].title),'Con aviso solo aparece la recepción antigua');
 assert(text.includes('Proveedor de cambios'));ok('La sección lista solo las recepciones con aviso, con estado en texto, proveedor y acción');
 await fillLabel('Estado','TODAS');await has(products[1].title);ok('El filtro «Todas las recepciones» incluye la reciente en plazo');
 await click('Configuración','.sidebar nav button');await has('Antigüedad y poca salida');await fillLabel('Objetivo de permanencia (meses)','7');await click('Guardar pagos y envíos');await has('Configuración guardada');
 const config=(await gql('{inventoryAging}')).inventoryAging.config;assert.equal(config.targetMonths,7);ok('Los umbrales se editan en Configuración y el servidor los aplica');
 // CMB-01: generar el cambio descuenta en ese momento; luego se vincula la reposición y se cierra con diferencia.
 const stock0=async()=>(await gql('query($id:ID!){product(id:$id){variants{sku stock}}}',{id:products[0].id})).product.variants.find(v=>v.sku===products[0].variants[0].sku).stock;
 const before=await stock0();
 await click('Antigüedad y cambios','.sidebar nav button');await has('Recepciones en inventario');await click('Preparar cambio');await has('Confirmo que estas unidades están selladas');
 await fillLabel('Unidades que se envían','4');
 assert(await js(`[...document.querySelectorAll('.exchange-form button')].find(b=>b.textContent.trim()==='Generar cambio').disabled`),'Sin confirmar el sellado no se puede generar');
 await js(`(()=>{const box=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Confirmo que estas unidades están selladas')).querySelector('input');box.click();return true;})()`);
 await shot('03-preparar-cambio');
 await js(`[...document.querySelectorAll('.exchange-form button')].find(b=>b.textContent.trim()==='Generar cambio').click()`);
 await waitFor(()=>js(`[...document.querySelectorAll('dialog button,[role=dialog] button')].some(b=>b.textContent.trim()==='Generar cambio')`),'confirmación');
 await js(`[...document.querySelectorAll('dialog button,[role=dialog] button')].find(b=>b.textContent.trim()==='Generar cambio').click()`);
 await has('generado: 4 unidades salieron del inventario');
 assert.equal(await stock0(),before-4);ok('Generar el cambio pide sellado confirmado y descuenta las 4 unidades en ese momento');
 await has('Pendiente de reposición: $80,00');ok('El valor enviado queda pendiente de reposición a costo con IVA');
 const replacement=(await gql('mutation($i:JSON!){savePurchase(input:$i)}',{i:{supplierId:supplier.id,warehouseId:'main',items:[{productId:products[2].id,sku:products[2].variants[0].sku,quantity:3,unitCost:20,lot:'REPO',expiresOn:'2090-01-01'}]}})).savePurchase;
 await click('Actualizar');await delay(600);
 await click('Vincular compra de reposición');await fillLabel('Compra de reposición',replacement.id);await click('Confirmar','.exchange-action button');await has('Reposición vinculada.');await has('$20,00');
 await click('Cerrar','.aging-list .row-actions button');await fillLabel('Cómo se resolvió la diferencia','Nota de crédito por 20 USD');await click('Confirmar','.exchange-action button');await has('Cambio cerrado.');await has('Cerrado con diferencia');
 ok('La reposición de otro producto se vincula, la diferencia de 20 USD queda visible y el cambio se cierra explicándola');
 // RES-01: una venta se atribuye a su compra y el período personalizado filtra por fechas.
 const sale=(await gql('mutation($input:CheckoutInput!){createCheckoutOrder(input:$input){id}}',{input:{idempotencyKey:crypto.randomUUID(),expectedTotal:undefined,customer:{fullName:'Cliente de prueba',email:'cliente.resultados@gmail.com',phone:'0999999999',province:'Pichincha',city:'Quito',address:'Dirección de prueba 123',idNumber:'1700000001'},items:[{productId:products[0].id,variantSku:products[0].variants[0].sku,quantity:1}],shippingMethod:'EXPRESS_QUITO_VALLES',paymentMethod:'BANK_TRANSFER'}})).createCheckoutOrder;
 await gql('mutation($id:ID!){updateOrderStatus(id:$id,status:PAID){id}}',{id:sale.id});
 await click('Ventas y resultados','.sidebar nav button');await has('Resultados por compra');await has('1 de 6 vendidas');await shot('04-resultados-por-compra');
 ok('«Resultados por compra» atribuye la venta a su compra de origen (1 de 6 vendidas)');
 await click('Personalizado');await fillLabel('Desde',ec(1));await fillLabel('Hasta',ec(0));await has(`Del ${ec(1)} al ${ec(0)}`);
 ok('El período personalizado cambia el informe a «Del … al …»');
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
 await js(`(()=>{const b=[...document.querySelectorAll('.sidebar nav button')].find(b=>b.textContent.trim()==='Antigüedad y cambios');b.click();return true;})()`);await has('Recepciones en inventario');await delay(300);
 const overflow=await js('document.documentElement.scrollWidth-window.innerWidth');await shot('02-telefono');assert(overflow<=1,`desplazamiento horizontal ${overflow}px`);ok('A 390 px la sección se lee en tarjetas sin desbordarse');
 assert.deepEqual(exceptions,[]);
 await writeFile(join(out,'report.json'),JSON.stringify({ok:true,checks},null,2));
 console.log(JSON.stringify({ok:true,artifacts:out,checks:checks.length}));
}catch(error){if(inspect)try{await writeFile(join(out,'screen.txt'),await inspect());}catch{}console.error(error.message);await writeFile(join(out,'failure.log'),`${error.stack}\n\n${logs.join('').slice(-12000)}`);console.error(`Diagnóstico: ${out}`);process.exitCode=1;}
finally{socket?.close();for(const child of processes.reverse())child.kill('SIGTERM');}
