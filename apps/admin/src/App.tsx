import { usePanelRoute, usePanelFilter } from "./lib/usePanelRoute";
import { useLeaveGuard } from "./components/common/UnsavedChanges";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { Eye, LogOut, Menu, Search, X, Upload, Plus, ArrowLeft } from "lucide-react";
import { PRODUCT_FIELDS, ORDER_FIELDS, DELETE_PRODUCT, SET_PRODUCT_FEATURED, GET_ADMIN_PRODUCTS, ME, ORDERS, EDIT_TAXONOMY, RESTORE_PRODUCT, STORE_SETTINGS, TAXONOMY, UPDATE_ORDER_STATUS, type AuthUser, type Order, type OrderConnection, type OrderStatus, type Product, type ProductConnection, type StoreSettings, type TaxonomyOverview } from "@vital-forge/shared-logic";
import { navigation, sectionLabel, roleLabels, canEditCatalog, canEditStock, type Section } from "./components/layout/navigation";
import { useConfirm } from "./components/common/ConfirmDialog";
import { ProductEditor, ProductList } from "./features/catalog/ProductEditor";
import { MergeProductDialog } from "./features/catalog/MergeProductDialog";
import { LoginGate } from "./features/security/LoginGate";
const HomePanel = lazy(() => import("./features/home/HomePanel").then(m => ({default: m.HomePanel})));
const ManagementPanel = lazy(() => import("./components/ManagementPanel").then(m => ({default: m.ManagementPanel})));
const BusinessDashboard = lazy(() => import("./features/business/BusinessDashboard").then(m => ({ default: m.BusinessDashboard })));
const ExpensesPanel = lazy(() => import("./features/business/ExpensesPanel").then(m => ({ default: m.ExpensesPanel })));
const AccountsPanel = lazy(() => import("./components/SystemPanels").then(m => ({default: m.AccountsPanel})));
const AuditPanel = lazy(() => import("./components/SystemPanels").then(m => ({default: m.AuditPanel})));
const DatabasePanel = lazy(() => import("./components/SystemPanels").then(m => ({default: m.DatabasePanel})));
const MediaPanel = lazy(() => import("./components/SystemPanels").then(m => ({default: m.MediaPanel})));
const OrderEditor = lazy(() => import("./components/OrderEditor").then(m => ({default: m.OrderEditor})));
const OrdersPanel = lazy(() => import("./components/OperationalPanels").then(m => ({default: m.OrdersPanel})));
const SettingsPanel = lazy(() => import("./components/OperationalPanels").then(m => ({default: m.SettingsPanel})));
const TaxonomyPanel = lazy(() => import("./components/TaxonomyPanel").then(m => ({default: m.TaxonomyPanel})));
const SupplyPanel = lazy(() => import("./features/supply/SupplyPanel").then(m => ({default: m.SupplyPanel})));
const SecurityPanel = lazy(() => import("./features/security/SecurityPanel").then(m => ({default: m.SecurityPanel})));
const ImportPanel = lazy(() => import("./features/catalog/ImportPanel").then(m => ({default: m.ImportPanel})));
const CampaignsPanel = lazy(() => import("./features/campaigns/CampaignsPanel").then(m => ({default: m.CampaignsPanel})));
const PRODUCT_RECORD=gql`${PRODUCT_FIELDS} query AdminProductRecord($id:ID!){product(id:$id){...ProductFields}}`;
const ORDER_RECORD=gql`${ORDER_FIELDS} query AdminOrderRecord($id:ID!){order(id:$id){...OrderFields}}`;
const LOGOUT=gql`mutation Logout { logout }`;
const WEB_URL = import.meta.env.VITE_WEB_URL ?? "http://localhost:5173";
const GRAPHQL_URL = import.meta.env.VITE_GRAPHQL_URL ?? "http://localhost:4000/graphql";
function useDebounced(value: string) { const [result,setResult] = useState(value); useEffect(() => { const timer=setTimeout(() => setResult(value),300); return () => clearTimeout(timer); },[value]); return result; }
function storedUser(): AuthUser | null { try { const user=JSON.parse(localStorage.getItem("rawenergy-user") || "null"); return user && user.role !== "CUSTOMER" ? user : null; } catch { return null; } }
export default function App() {
 const client=useApolloClient(); const confirm=useConfirm(); const canLeave=useLeaveGuard(); const {route,go}=usePanelRoute(canLeave); const section=route.section;
 const [admin,setAdmin]=useState(storedUser); const [mobile,setMobile]=useState(false); const [compact,setCompact]=useState(()=>matchMedia("(max-width:900px)").matches);
 const [editing,setEditing]=useState<Product | null | undefined>(); const [editorVersion,setEditorVersion]=useState(0); const [dirty,setDirty]=useState(false); const [orderEdit,setOrderEdit]=useState<Order | null | undefined>();
 const [search,setSearch]=usePanelFilter("q",""); const debounced=useDebounced(search); const [showArchived,setShowArchived]=usePanelFilter("archived",false); const [featuredOnly,setFeaturedOnly]=usePanelFilter("featured",false);
 const [orderStatus,setOrderStatus]=usePanelFilter<OrderStatus | "">("status",""); const [orderSearch,setOrderSearch]=usePanelFilter("q",""); const orderTerm=useDebounced(orderSearch); const [orderPage,setOrderPage]=usePanelFilter("page",0);
 const [message,setMessage]=useState(""); const [success,setSuccess]=useState(""); const [merging,setMerging]=useState<Product|null>(null);
 useEffect(()=>{const media=matchMedia("(max-width:900px)");const change=()=>{setCompact(media.matches);if(!media.matches)setMobile(false);};media.addEventListener("change",change);return()=>media.removeEventListener("change",change);},[]);
 useEffect(()=>{if(!mobile)return;const previous=document.activeElement as HTMLElement|null;const aside=document.querySelector<HTMLElement>(".sidebar");const items=()=>[...aside?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")??[]].filter(el=>el.getClientRects().length);(aside?.querySelector<HTMLButtonElement>('[aria-current="page"]')??items()[0])?.focus();const handler=(e:KeyboardEvent)=>{if(e.key==="Escape"){setMobile(false);return;}if(e.key!=="Tab")return;const list=items();const first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};document.addEventListener("keydown",handler);return()=>{document.removeEventListener("keydown",handler);previous?.focus();};},[mobile]);
 const me=useQuery<{me: AuthUser | null}>(ME,{skip: !localStorage.getItem("rawenergy-token"),pollInterval:60000,fetchPolicy:"network-only"});
 const products=useQuery<{searchProducts:ProductConnection}>(GET_ADMIN_PRODUCTS,{variables:{filters:{search:debounced,status:showArchived?"ALL":"ACTIVE",...(featuredOnly?{featured:true}:{})},pagination:{first:30}},skip:!admin || section!=="products",fetchPolicy:"cache-and-network"});
 const orders=useQuery<{orders:OrderConnection}>(ORDERS,{variables:{filters:{...(orderStatus?{status:orderStatus}:{}),search:orderTerm},limit:20,offset:orderPage*20},skip:!admin || section!=="orders",fetchPolicy:"cache-and-network"});
 const settings=useQuery<{storeSettings:StoreSettings}>(STORE_SETTINGS,{skip:admin?.role!=="ADMIN" || section!=="settings"});
 const taxonomy=useQuery<{taxonomy:TaxonomyOverview}>(TAXONOMY,{skip:!admin || section!=="taxonomy"});
 const [endSession]=useMutation(LOGOUT);
 const [archive]=useMutation(DELETE_PRODUCT); const [setFeatured]=useMutation(SET_PRODUCT_FEATURED); const featuring=useRef(new Set<string>()); const [restore]=useMutation(RESTORE_PRODUCT); const [status]=useMutation(UPDATE_ORDER_STATUS); const [editTaxonomy]=useMutation(EDIT_TAXONOMY);
 const logout=async () => { localStorage.removeItem("rawenergy-token"); localStorage.removeItem("rawenergy-user"); setAdmin(null); setMobile(false); setEditing(undefined); setDirty(false); await client.clearStore(); };
 useEffect(() => { if(me.data?.me && me.data.me.role!=="CUSTOMER") { setAdmin(me.data.me); localStorage.setItem("rawenergy-user",JSON.stringify(me.data.me)); } else if(me.data) void logout(); },[me.data]);

 const allowed = admin ? navigation.flatMap(g=>g.items).filter(i=>i.roles.includes(admin.role)).map(i=>i.id) : [];
 useEffect(() => { if(admin && !allowed.includes(section) && !(section==="import" && canEditCatalog(admin.role))) void go("home",{},true); },[admin?.role,section]);
 const navigate=async (next:Section,term?:string) => {
   const params:Record<string,string>|undefined=term===undefined?undefined:term.startsWith("status:")?{status:term.slice(7)}:{q:term};
   await go(next,params);
 };
 const newProduct=async () => { if(admin && canEditCatalog(admin.role)) await go("products",{...(section==="products"?route.params:{}),record:"new"}); };
 const recordId=route.params.record;
 const productRecord=useQuery<{product:Product|null}>(PRODUCT_RECORD,{variables:{id:recordId?.replace(/^copy:/,"")},skip:!admin||!canEditCatalog(admin.role)||section!=="products"||!recordId||recordId==="new"});
 const orderRecord=useQuery<{order:Order|null}>(ORDER_RECORD,{variables:{id:recordId},skip:!admin||!canEditStock(admin.role)||section!=="orders"||!recordId||recordId==="new"});
 useEffect(()=>{
   setEditing(undefined);setOrderEdit(undefined);setDirty(false);setMobile(false);setMessage("");
   if(admin&&canEditCatalog(admin.role)&&section==="products"&&recordId==="new"){setEditorVersion(v=>v+1);setEditing(null);}
   if(admin&&canEditStock(admin.role)&&section==="orders"&&recordId==="new")setOrderEdit(null);
 },[section,recordId,admin?.role]);
 useEffect(()=>{setSuccess("");},[section]);
 // Al cambiar de sección o abrir un editor, el foco va al título (C52): con teclado o lector de
 // pantalla no hay que recorrer de nuevo todo el menú. Se espera a que el módulo termine de cargar
 // y, si el título cambia (lista → editor), se sigue al nuevo mientras nadie haya movido el foco.
 const firstView=useRef(true);
 useEffect(()=>{
   if(firstView.current){firstView.current=false;return;}
   let focused:HTMLElement|null=null; let tries=0; let timer=0;
   const origin=document.activeElement;
   const step=()=>{
     const active=document.activeElement as HTMLElement|null;
     // «Libre»: el foco sigue en el control que navegó (menú, barra superior) o se perdió; si la persona ya se movió, no se toca.
     const idle=!active||active===document.body||active===origin||active===focused||(focused!==null&&!focused.isConnected)||!!active.closest(".sidebar,.topbar");
     if(!idle)return;
     const title=document.querySelector<HTMLElement>("#main-content .admin-page [data-view-title]")??document.querySelector<HTMLElement>("#main-content .admin-page h1");
     if(title&&title!==focused){if(!title.hasAttribute("tabindex"))title.setAttribute("tabindex","-1");title.focus();focused=title;}
     if(++tries<20)timer=window.setTimeout(step,100);
   };
   timer=window.setTimeout(step,50);
   return()=>window.clearTimeout(timer);
 },[section,recordId]);
 useEffect(()=>{
   if(!admin||!canEditCatalog(admin.role)||section!=="products"||!recordId||recordId==="new"||productRecord.data?.product?.id!==recordId.replace(/^copy:/,""))return;
   const p=productRecord.data.product;
   setEditing(recordId.startsWith("copy:")?{...p,id:"",title:`${p.title.slice(0,110)} (copia)`,slug:`${p.slug.slice(0,120)}-copia-${Date.now().toString(36)}`,variants:p.variants.map(v=>({...v,stock:0,sku:`${v.sku.slice(0,60)}-C${Date.now().toString(36)}`}))}:p);
 },[section,recordId,productRecord.data,admin?.role]);
 useEffect(()=>{if(admin&&canEditStock(admin.role)&&section==="orders"&&recordId&&recordId!=="new"&&orderRecord.data?.order?.id===recordId)setOrderEdit(orderRecord.data.order);},[section,recordId,orderRecord.data,admin?.role]);
 const run=async (work:()=>Promise<unknown>, successText?:string) => {setMessage("");setSuccess("");try {await work();if(successText)setSuccess(successText);await client.refetchQueries({include:"active"}).catch(()=>setMessage("Los datos se guardaron, pero no se pudo actualizar la lista. Vuelve a cargarla."));}catch(e){setMessage(e instanceof Error?e.message:"No se pudo completar la operación");}};
 if(!admin) return <LoginGate onLogin={user=>{setAdmin(user);void go("home",{},true);}}/>;
 const productRows=products.data?.searchProducts.edges.map(e=>e.node)??[];
 const activeError=section==="products"?products.error:section==="orders"?orders.error:section==="taxonomy"?taxonomy.error:section==="settings"?settings.error:undefined;
 const dataStatus=(loading:boolean,error:unknown)=>error?"error" as const:loading?"loading" as const:"ok" as const;
 const showHistory=["ADMIN","MANAGER"].includes(admin.role);
 return <div className={`admin-shell ${mobile?"nav-open":""}`}>
  <a className="skip-link" href="#main-content" onClick={event=>{event.preventDefault();document.getElementById("main-content")?.focus();}}>Saltar al contenido</a>
  {mobile && <button className="nav-backdrop" aria-label="Cerrar menú" onClick={()=>setMobile(false)}/>}
  <aside className="sidebar" inert={compact&&!mobile} aria-hidden={compact&&!mobile} aria-label="Navegación principal"><button className="admin-logo" onClick={()=>void navigate("home")}><b>RAWENERGY</b><span>EC</span><i>GESTIÓN</i></button><button className="mobile-close" aria-label="Cerrar menú" onClick={()=>setMobile(false)}><X/></button>
   <nav>{navigation.map(group=>{const items=group.items.filter(i=>i.roles.includes(admin.role));return items.length?<div className="nav-section" key={group.group}><span className="nav-group">{group.group}</span>{items.map(({id,label,icon:Icon})=><button key={id} aria-current={section===id?"page":undefined} className={section===id?"active":""} onClick={()=>void navigate(id)}><Icon/><span>{label}</span></button>)}</div>:null;})}</nav>
   <div className="side-bottom"><div className="profile"><span>{admin.name.slice(0,2).toUpperCase()}</span><div><b>{admin.name}</b><small>{roleLabels[admin.role]}</small></div></div><button onClick={async()=>{if(await canLeave()) {try{await endSession();await logout();}catch(error){setMessage(error instanceof Error?error.message:"No se pudo revocar la sesión. Vuelve a intentarlo.");}}}}><LogOut/><span>Cerrar sesión</span></button></div>
  </aside>
  <main className="admin-main" inert={compact&&mobile} id="main-content" tabIndex={-1}><header className="topbar"><button className="mobile-menu" aria-label="Abrir menú" aria-expanded={mobile} onClick={()=>setMobile(true)}><Menu/></button><div className="breadcrumb"><span>Gestión</span><b>/</b><strong>{editing!==undefined?(editing?.id?"Editar producto":"Nuevo producto"):sectionLabel(section)}</strong></div><div className="top-actions"><a className="preview" href={WEB_URL} target="_blank" rel="noopener noreferrer"><Eye/>Ver tienda</a>{canEditCatalog(admin.role)&&<button className="publish" onClick={()=>void newProduct()}><Plus/>Nuevo producto</button>}</div></header>
   <div className="admin-page">{(message||activeError)&&<div role="alert" className="admin-alert"><span>{message||activeError?.message}</span><button onClick={()=>void run(()=>client.refetchQueries({include:"active"}))}>Reintentar</button></div>}
   {success&&<p className="admin-success" role="status">{success}</p>}
   {recordId&&((section==="products"&&!canEditCatalog(admin.role))||(section==="orders"&&!canEditStock(admin.role)))&&<p role="status">Tu perfil permite consultar esta sección. La edición requiere permisos de administración.</p>}
   {recordId&&recordId!=="new"&&((section==="products"&&productRecord.data?.product===null)||(section==="orders"&&orderRecord.data?.order===null))&&<p role="alert">No se encontró el registro solicitado. Puedes volver a la lista desde el menú.</p>}
   {(productRecord.error||orderRecord.error)&&<p role="alert">{productRecord.error?.message||orderRecord.error?.message}</p>}
   {(productRecord.loading||orderRecord.loading)&&recordId&&<p role="status">Cargando registro…</p>}
   <Suspense fallback={<div className="module-loading" role="status">Cargando módulo…</div>}>
    {editing!==undefined&&canEditCatalog(admin.role) ? <ProductEditor ownerId={admin.id} canManageStock={canEditStock(admin.role)} key={`${editing?.id||"new"}:${editorVersion}`} product={editing} onDirtyChange={setDirty} onCancel={()=>void navigate("products")} onDone={()=>{setDirty(false);void go("products",{...route.params,record:""},true).then(accepted=>{if(accepted)setSuccess("Producto guardado.");});void products.refetch().catch(()=>setMessage("El producto se guardó, pero no se pudo actualizar la lista. Vuelve a cargarla."));}}/> : <>
    {section==="home"&&<HomePanel user={admin} onNavigate={(s,t)=>void navigate(s,t)} onCreate={()=>void newProduct()}/>}
    {section==="products"&&<><div className="catalog-tools"><label className="admin-search"><Search/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nombre, marca o SKU" aria-label="Buscar producto"/></label>{canEditCatalog(admin.role)&&<button onClick={()=>void navigate("import")}><Upload/>Importar Excel / CSV</button>}</div><ProductList products={productRows} total={products.data?.searchProducts.totalCount??0} showArchived={showArchived} featuredOnly={featuredOnly} dataStatus={dataStatus(products.loading,products.error)} onToggleArchived={setShowArchived} onToggleFeaturedOnly={setFeaturedOnly} onFeatured={p=>{if(featuring.current.has(p.id))return;featuring.current.add(p.id);void run(()=>setFeatured({variables:{id:p.id,featured:!p.featured,revision:p.revision??0}}),p.featured?`«${p.title}» ya no aparece en Destacados.`:`«${p.title}» aparece en Destacados de la tienda.`).finally(()=>featuring.current.delete(p.id));}} onCreate={()=>void newProduct()} onEdit={p=>void go("products",{...route.params,record:p.id})} readonly={!canEditCatalog(admin.role)} onArchive={p=>void run(()=>archive({variables:{id:p.id}}),"Producto archivado.")} onRestore={p=>void run(()=>restore({variables:{id:p.id}}),"Producto restaurado.")} onHistory={showHistory?p=>void navigate("audit",p.id):undefined} onDuplicate={p=>void go("products",{...route.params,record:`copy:${p.id}`})} onMerge={admin.role==="ADMIN"?p=>setMerging(p):undefined}/>{merging&&<MergeProductDialog source={merging} onClose={()=>setMerging(null)} onDone={text=>{setMerging(null);setSuccess(text);void products.refetch().catch(()=>setMessage("Se unieron, pero no se pudo actualizar la lista. Vuelve a cargarla."));}}/>}{products.data?.searchProducts.pageInfo.hasNextPage&&<button disabled={products.loading} onClick={()=>void products.fetchMore({variables:{pagination:{first:30,after:products.data?.searchProducts.pageInfo.endCursor}}}).catch(e=>setMessage(e.message))}>Cargar más ({productRows.length} de {products.data.searchProducts.totalCount})</button>}</>}
    {section==="import"&&<ImportPanel onDone={()=>void navigate("products")}/>}
    {section==="campaigns"&&<CampaignsPanel webUrl={WEB_URL}/>}
    {section==="orders"&&<>{canEditStock(admin.role)&&<div className="section-toolbar"><button className="primary-button" onClick={()=>void go("orders",{...route.params,record:"new"})}><Plus/>Crear pedido</button></div>}{orderEdit!==undefined&&canEditStock(admin.role)&&<article className="report-card"><button onClick={()=>void go("orders",{...route.params,record:""})}><ArrowLeft/>Volver a pedidos</button><OrderEditor key={orderEdit?.id??"new"} row={orderEdit as unknown as (Record<string,unknown>&{id:string})|null}/></article>}<OrdersPanel orders={orders.data?.orders.orders??[]} total={orders.data?.orders.totalCount??0} status={orderStatus} search={orderSearch} page={orderPage} dataStatus={dataStatus(orders.loading,orders.error)} onStatusFilter={value=>{setOrderPage(0);setOrderStatus(value);}} onSearch={value=>{setOrderPage(0);setOrderSearch(value);}} onPage={setOrderPage} readonly={!canEditStock(admin.role)} onEdit={p=>void go("orders",{...route.params,record:p.id})} onHistory={showHistory?id=>void navigate("audit",id):undefined} onStatus={async(id,next)=>{if(!await canLeave())return;if(await confirm({title:"Cambiar estado del pedido",message:next==="CANCELLED"?"La cancelación liberará las reservas y registrará el movimiento de inventario.":"Se actualizará el pedido y se notificará al cliente si el correo está configurado.",confirmLabel:"Actualizar estado",danger:next==="CANCELLED"})) await run(()=>status({variables:{id,status:next}}),"Estado del pedido actualizado.");}}/></>}
    {section==="taxonomy"&&<TaxonomyPanel taxonomy={taxonomy.data?.taxonomy} loading={taxonomy.loading} error={!!taxonomy.error} onApply={async(kind,action,key,target)=>{await editTaxonomy({variables:{kind,action,key,...(target?{target}:{})}});setSuccess("Categorías y marcas actualizadas.");await taxonomy.refetch().catch(()=>setMessage("El cambio se guardó, pero no se pudo actualizar la lista. Vuelve a cargarla."));}}/>}
    {section==="media"&&<MediaPanel/>}
    {section==="management"&&<BusinessDashboard readonly={admin.role!=="ADMIN"} onNavigate={(s,t)=>void navigate(s,t)}/>}
    {section==="inventory"&&<ManagementPanel inventoryOnly readonly={!canEditStock(admin.role)} initialSearch={search}/>}
    {section==="expenses"&&<ExpensesPanel readonly={admin.role!=="ADMIN"} onNavigate={(s,t)=>void navigate(s,t)}/>}
    {(["purchases","suppliers","warehouses","movements"] as Section[]).includes(section)&&<SupplyPanel key={section} section={section} readonly={!canEditStock(admin.role)} initialSearch={search}/>}
    {section==="customers"&&<AccountsPanel currentUserId={admin.id}/>}
    {section==="audit"&&<AuditPanel/>}
    {section==="database"&&<DatabasePanel onNavigate={s=>void navigate(s)} onProduct={p=>void go("products",{record:p.id})} orderEditor={row=><OrderEditor key={row?.id??"new"} row={row}/>}/>}
    {section==="settings"&&<SettingsPanel settings={settings.data?.storeSettings} adminEmail={admin.email} graphqlUrl={GRAPHQL_URL} dataStatus={dataStatus(settings.loading,settings.error)}/>}
    {section==="security"&&<SecurityPanel onLogout={()=>void logout()}/>}
    </>}
   </Suspense></div>
  </main>
 </div>;
}
