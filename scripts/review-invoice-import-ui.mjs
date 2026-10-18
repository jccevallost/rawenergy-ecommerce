// IMP-01: recorrido aislado de la importación de una factura en PDF. API en memoria (no lee .env ni toca la
// base real), perfil temporal de Chrome. El PDF no se guarda en el repositorio: se indica su ruta.
// Uso: FACTURA_PDF=/ruta/factura.pdf node scripts/review-invoice-import-ui.mjs
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const pdf=process.env.FACTURA_PDF;assert(pdf&&existsSync(pdf),'Indica FACTURA_PDF con la ruta de la factura en PDF');
const root=resolve('.');const out=await mkdtemp(join(tmpdir(),'rawenergy-import-ui-'));
const apiPort=14871,uiPort=14872,debugPort=14873;const api=`http://127.0.0.1:${apiPort}`,ui=`http://127.0.0.1:${uiPort}`;
const env={PATH:process.env.PATH,NODE_ENV:'development',DOTENV_CONFIG_PATH:'/dev/null',PORT:String(apiPort),PUBLIC_API_URL:api,AUTH_TOKEN_SECRET:'isolated-import-review-secret-1234567890',ADMIN_EMAIL:'importa@example.com',ADMIN_PASSWORD:'Review-only-123!',ADMIN_NAME:'Equipo de prueba',VITE_GRAPHQL_URL:`${api}/graphql`,VITE_WEB_URL:'http://localhost:5173'};
const processes=[];const logs=[];let socket;let inspect;
const launch=(command,args,options={})=>{const child=spawn(command,args,{cwd:root,env,stdio:['ignore','pipe','pipe'],...options});processes.push(child);child.stdout.on('data',d=>logs.push(String(d)));child.stderr.on('data',d=>logs.push(String(d)));return child;};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,label){let last;for(let i=0;i<120;i++){try{const v=await fn();if(v)return v;}catch(e){last=e;}await delay(150);}throw new Error(`Timeout: ${label}${last?` (${last.message})`:''}`);}
let token='';async function gql(query,variables={}){const r=await fetch(`${api}/graphql`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({query,variables})});const b=await r.json();if(b.errors)throw new Error(b.errors[0].message);return b.data;}
const checks=[];const ok=t=>{checks.push(t);console.log(`✓ ${t}`);};
try{
 launch(process.execPath,['--import','tsx','apps/api/src/server.ts']);
 launch(process.execPath,['node_modules/vite/bin/vite.js','apps/admin','--host','127.0.0.1','--port',String(uiPort),'--strictPort']);
 await waitFor(async()=>(await fetch(`${api}/health`)).ok,'API');await waitFor(async()=>(await fetch(ui)).ok,'Panel');
 token=(await gql('mutation($i:LoginInput!){login(input:$i){token}}',{i:{email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD}})).login.token;
 const stockBefore=(await gql('{searchProducts(pagination:{first:50}){edges{node{variants{stock}}}}}')).searchProducts.edges.flatMap(e=>e.node.variants).reduce((s,v)=>s+v.stock,0);
 const chrome=process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 launch(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${join(out,'profile')}`,'--window-size=1440,1000','about:blank'],{env:{...env,HOME:process.env.HOME}});
 const tabs=await waitFor(async()=>{const t=await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();return t.length?t:null;},'Chrome');
 socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 const pending=new Map();let serial=0;const exceptions=[];
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const t=pending.get(m.id);pending.delete(m.id);m.error?t.reject(new Error(m.error.message)):t.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const js=async e=>{const r=await cdp('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??'JS');return r.result.value;};
 const click=(text,sel='button')=>js(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.trim().startsWith(${JSON.stringify(text)})&&b.getClientRects().length);if(!b)throw new Error(${JSON.stringify('No encontrado: '+text)});b.click();return true;})()`);
 const has=t=>waitFor(()=>js(`document.body.innerText.includes(${JSON.stringify(t)})`),t);
 const shot=async n=>{await delay(250);const r=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(out,`${n}.png`),Buffer.from(r.data,'base64'));};
 inspect=async()=>{await shot('failure');return js('document.body.innerText');};
 const setFile=async()=>{const {root:doc}=await cdp('DOM.getDocument',{depth:-1});const {nodeId}=await cdp('DOM.querySelector',{nodeId:doc.nodeId,selector:'input[type=file]'});await cdp('DOM.setFileInputFiles',{nodeId,files:[pdf]});};
 await cdp('Runtime.enable');await cdp('Page.enable');await cdp('DOM.enable');
 await cdp('Page.navigate',{url:ui});await has('Iniciar sesión');
 await js(`(()=>{for(const [s,v] of [['input[type=email]',${JSON.stringify(env.ADMIN_EMAIL)}],['input[type=password]',${JSON.stringify(env.ADMIN_PASSWORD)}]]){const e=document.querySelector(s);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));}return true;})()`);
 await click('Entrar al panel');await has('Buen día');
 await click('Órdenes de compra','.sidebar nav button');await has('Importar factura PDF');await click('Importar factura PDF');await has('Factura en PDF');
 await setFile();await has('Cuadra: subtotal');await shot('01-factura-leida');
 const summary=await js('document.querySelector(".invoice-import").innerText');
 for(const text of ['Factura 002-100-000004199','FITLAB SUPLEMENTOS S.A.S','1793213242001','$496,44','Faltan 10 de 10'])assert(summary.includes(text),`Falta «${text}» en la revisión`);
 ok('El PDF se lee: proveedor, número, 10 líneas, conciliación 431,69 + 64,75 = 496,44 y 10 líneas por completar');
 assert(await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Registrar compra en borrador')).disabled`));
 ok('No se puede registrar mientras falten productos o vencimientos');
 for(let i=0;i<10;i++){
  await js(`(()=>{const li=document.querySelectorAll('.import-lines>li')[${i}];[...li.querySelectorAll('button')].find(b=>/Elegir producto|Cambiar/.test(b.textContent)).click();return true;})()`);
  await waitFor(()=>js(`(()=>{const li=document.querySelectorAll('.import-lines>li')[${i}];const input=li.querySelector('.import-picker input');if(!input)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'a');input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`),'buscador');
  await waitFor(()=>js(`document.querySelectorAll('.import-lines>li')[${i}].querySelectorAll('.import-picker ul button').length>0`),'resultados');
  await js(`document.querySelectorAll('.import-lines>li')[${i}].querySelector('.import-picker ul button').click()`);
  await js(`(()=>{const input=document.querySelectorAll('.import-lines>li')[${i}].querySelector('input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2090-01-01');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
 }
 await has('Todas las líneas están completas');await shot('02-lineas-completas');
 await click('Registrar compra en borrador');await has('creada en borrador');
 ok('Con producto y vencimiento por línea se crea la compra en borrador con la factura');
 const purchases=(await gql('{supplyOverview}')).supplyOverview.purchases;
 const created=purchases.find(p=>p.document?.number==='002-100-000004199');
 assert(created&&created.status==='DRAFT'&&created.total===496.44,'Compra en borrador por 496,44');
 const stockAfter=(await gql('{searchProducts(pagination:{first:50}){edges{node{variants{stock}}}}}')).searchProducts.edges.flatMap(e=>e.node.variants).reduce((s,v)=>s+v.stock,0);
 assert.equal(stockAfter,stockBefore);ok('La compra queda en borrador por 496,44 y el stock no cambia');
 await click('Importar factura PDF');await has('Factura en PDF');await setFile();await has('Ya se registró como compra');
 ok('Volver a subir el mismo PDF abre la importación existente sin crear otra compra');
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});await delay(400);
 const overflow=await js('document.documentElement.scrollWidth-window.innerWidth');await shot('03-telefono');assert(overflow<=1,`desplazamiento horizontal ${overflow}px`);
 ok('A 390 px la importación no se desborda');
 assert.deepEqual(exceptions,[]);
 await writeFile(join(out,'report.json'),JSON.stringify({ok:true,checks,limits:['API en memoria y Chrome sin interfaz en macOS; no registra en la base real']},null,2));
 console.log(JSON.stringify({ok:true,artifacts:out,checks:checks.length}));
}catch(error){if(inspect)try{await writeFile(join(out,'screen.txt'),await inspect());}catch{}console.error(error.message);await writeFile(join(out,'failure.log'),`${error.stack}\n\n${logs.join('').slice(-12000)}`);console.error(`Diagnóstico: ${out}`);process.exitCode=1;}
finally{socket?.close();for(const child of processes.reverse())child.kill('SIGTERM');}
