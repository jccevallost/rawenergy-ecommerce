import { randomUUID } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import depthLimit from "graphql-depth-limit";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { demoProducts } from "../data/demoProducts.js";
import { authService, type AuthUser } from "./auth.service.js";
import { productService } from "./product.service.js";
import { orderService } from "./order.service.js";
import { supplyService } from "./supply.service.js";
import { auditService } from "./audit.service.js";
import { mailService } from "./mail.service.js";
import { telegramService } from "./telegram.service.js";
import { computeManagement } from "./management.service.js";

vi.spyOn(mailService,"sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService,"sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(mailService,"sendStatusUpdate").mockResolvedValue(true);
vi.spyOn(telegramService,"sendOrderAlert").mockResolvedValue(true);
const server=new ApolloServer({typeDefs,resolvers,validationRules:[depthLimit(4)]});
let admin:AuthUser;
beforeAll(async()=>{authService.setPersistence(false);await authService.bootstrapAdmin();admin=(await authService.users("ADMIN"))[0]!;});
afterAll(()=>server.stop());
async function execute(query:string,variables:Record<string,unknown>={},user:AuthUser|null=admin) {
  const result=await server.executeOperation({query,variables},{contextValue:{user,requestId:randomUUID()}});
  if(result.body.kind!=="single")throw new Error("Respuesta inesperada");
  return result.body.singleResult;
}
async function fixture(stock=10) {
  const payload=structuredClone(demoProducts[1]!);payload.slug=`regression-${randomUUID()}`;payload.title=payload.slug;payload.variants=[{...payload.variants[0]!,stock,images:[{url:"https://example.com/photo.webp",alt:"Etiqueta nutricional y fecha de vencimiento"}]}];
  const created=await productService.upsert(undefined,payload) as {id:string};
  const productId=created.id,sku=payload.variants[0]!.sku;
  const checkout={idempotencyKey:randomUUID(),customer:{fullName:"Revisión de pedidos",email:"review@example.test",phone:"0999999999",province:"Pichincha",city:"Quito",address:"Dirección de prueba 123",idNumber:"1700000001",reference:""},items:[{productId,variantSku:sku,quantity:2}],shippingMethod:"EXPRESS_QUITO_VALLES",paymentMethod:"BANK_TRANSFER"};
  return {productId,sku,payload,checkout,stock:async()=>(await productService.get(productId))!.variants[0]!.stock};
}
async function dispatch(id:string) {for(const status of ["PAID","PREPARING","SHIPPED"])await orderService.updateStatus(id,status);}

describe("Regresiones de la revisión del panel",()=>{
  it("bloquea saltos de estado y cancelaciones después del despacho; devolución y reembolso no duplican stock",async()=>{
    const f=await fixture();const order=await orderService.create(f.checkout);const id=String(order.id);
    await expect(orderService.updateStatus(id,"COMPLETED")).rejects.toThrow(/no permitido/);
    await dispatch(id);await orderService.updateStatus(id,"COMPLETED");
    await expect(orderService.updateStatus(id,"CANCELLED")).rejects.toThrow(/devolución/);expect(await f.stock()).toBe(8);
    await orderService.recordReturn(id,{reason:"Mercancía recibida e inspeccionada",restock:true});
    await orderService.recordReturn(id,{reason:"Reintento de recepción",restock:true});expect(await f.stock()).toBe(10);
    await orderService.recordRefund(id,{reason:"Importe devuelto al cliente",reference:"REEMBOLSO-001"});
    await orderService.recordRefund(id,{reason:"Reintento de registro",reference:"REEMBOLSO-001"});expect(await f.stock()).toBe(10);
    const stored=await orderService.get(id);expect(stored?.status).toBe("RETURNED");expect(stored?.refund?.amount).toBe(order.total);
    expect(stored?.history?.filter(row=>row.to==="RETURNED")).toHaveLength(2); // receipt and refund, no retry events
  });
  it("no repone mercancía devuelta que no está en condiciones de venta",async()=>{
    const f=await fixture();const order=await orderService.create(f.checkout);await dispatch(String(order.id));
    await orderService.recordReturn(String(order.id),{reason:"Envases abiertos y dañados",restock:false});expect(await f.stock()).toBe(8);
  });
  it("distingue saldo físico, reservas y disponibilidad; protege archivo y conserva devoluciones a un origen archivado",async()=>{
    const f=await fixture(2);const warehouse=await supplyService.saveWarehouse(undefined,{name:"Bodega de reservas"});
    await supplyService.transfer({productId:f.productId,sku:f.sku,from:"main",to:warehouse.id,lot:"INICIAL",quantity:2,reason:"Ubicación de mercancía"});
    const order=await orderService.create(f.checkout);const id=String(order.id);
    expect((await supplyService.positions()).find(p=>p.productId===f.productId)).toMatchObject({onHand:2,reserved:2,available:0});
    await expect(supplyService.saveWarehouse(warehouse.id,{name:warehouse.name,active:false})).rejects.toThrow(/reservas/);
    await dispatch(id);await supplyService.saveWarehouse(warehouse.id,{name:warehouse.name,active:false});
    await orderService.recordReturn(id,{reason:"Recepción posterior al cierre de bodega",restock:true});
    expect((await supplyService.positions()).find(p=>p.productId===f.productId)).toMatchObject({warehouseId:"main",onHand:2,reserved:0,available:2});
  });
  it("dos solicitudes simultáneas con la misma referencia crean un solo pedido y una sola notificación",async()=>{
    const f=await fixture();const before=vi.mocked(mailService.sendOrderConfirmation).mock.calls.length;
    const query='mutation($input:CheckoutInput!){createCheckoutOrder(input:$input){id orderNumber}}';
    const results=await Promise.all([execute(query,{input:f.checkout}),execute(query,{input:f.checkout})]);
    results.forEach(r=>expect(r.errors).toBeUndefined());expect(results[0]!.data?.createCheckoutOrder).toEqual(results[1]!.data?.createCheckoutOrder);
    expect(await f.stock()).toBe(8);expect(vi.mocked(mailService.sendOrderConfirmation).mock.calls.length-before).toBe(1);
    const conflict=await execute(query,{input:{...f.checkout,notes:"Datos cambiados"}});expect(conflict.errors?.[0]?.message).toMatch(/otros datos/);expect(await f.stock()).toBe(8);
  });
  it("audita estados completos equivalentes y revierte stock si no puede escribir el resultado",async()=>{
    const f=await fixture();const query='mutation($input:JSON!){adjustStock(input:$input)}';
    const input={productId:f.productId,sku:f.sku,expectedStock:10,delta:-1,reorderPoint:8,reason:"Conteo físico de prueba"};
    expect((await execute(query,{input})).errors).toBeUndefined();
    const event=(await auditService.list({search:f.productId,status:"SUCCESS"})).rows.find(row=>row.action==="adjustStock")!;
    expect(event.before).toMatchObject({title:f.payload.title,variants:[{stock:10}]});expect(event.after).toMatchObject({title:f.payload.title,variants:[{stock:9,reorderPoint:8}]});
    const original=auditService.record.bind(auditService);
    const fail=vi.spyOn(auditService,"record").mockImplementation(async event=>{if(event.action==="adjustStock"&&event.status==="SUCCESS")throw new Error("Fallo de escritura del historial");return original(event);});
    try {expect((await execute(query,{input:{...input,expectedStock:9}})).errors).toBeDefined();}finally{fail.mockRestore();}
    expect(await f.stock()).toBe(9);expect((await auditService.list({search:f.productId,status:"FAILED"})).total).toBe(1);
  });
  it("conserva el pedido de un invitado en auditoría y atribuye un inicio de sesión exitoso a su cuenta",async()=>{
    const f=await fixture();
    const result=await execute('mutation($input:CheckoutInput!){createCheckoutOrder(input:$input){id}}',{input:f.checkout},null);
    expect(result.errors).toBeUndefined();
    const id=(result.data?.createCheckoutOrder as {id:string}).id;
    const event=(await auditService.list({search:id,status:"SUCCESS"})).rows.find(row=>row.action==="createCheckoutOrder")!;
    expect(event.after).toMatchObject({id,items:[{variantSku:f.sku,quantity:2}]});
    expect(JSON.stringify(event)).not.toContain(f.checkout.idempotencyKey);
    const user=await authService.saveAccount(admin,undefined,{name:"Acceso auditado",email:"audit-login@example.test",password:"Audit-login-123",role:"CATALOG",status:"ACTIVE"});
    expect((await execute('mutation($input:LoginInput!){login(input:$input){user{id}}}',{input:{email:user.email,password:"Audit-login-123"}},null)).errors).toBeUndefined();
    expect((await auditService.list({search:user.id,status:"SUCCESS"})).rows.find(row=>row.action==="login")).toMatchObject({actorId:user.id,actorEmail:user.email});
  });
  it("identifica automáticamente inicios sin resultado y vincula cambios masivos a cada producto",async()=>{
    const operationId=randomUUID();await auditService.record({operationId,requestId:randomUUID(),actorId:admin.id,actorEmail:admin.email,ip:"",action:"operacion-interrumpida",entity:"products",entityId:"pending",status:"STARTED"});
    expect((await auditService.list({status:"UNRESOLVED",search:operationId})).total).toBe(1);
    const f=await fixture();const oldBrand=f.payload.brand;
    expect((await execute('mutation($key:String!){editTaxonomy(kind:BRAND,action:RENAME,key:$key,target:"Marca revisada")}',{key:oldBrand})).errors).toBeUndefined();
    const event=(await auditService.list({search:f.productId,status:"SUCCESS"})).rows.find(row=>row.action==="editTaxonomy")!;
    expect(event.relatedEntityIds).toContain(f.productId);expect(JSON.stringify(event.after)).toContain("Marca revisada");
  });
  it("la consulta del catálogo transporta descripciones de todas las fotos y rechaza una ficha desactualizada",async()=>{
    const f=await fixture();const response=await execute('query($q:String!){searchProducts(filters:{search:$q}){edges{node{id revision variants{sku imageUrls imageAlts}}}}}',{q:f.payload.slug});
    expect(response.errors).toBeUndefined();const data=response.data as {searchProducts:{edges:Array<{node:{revision:number;variants:Array<{imageUrls:string[];imageAlts:string[]}>}}>}};
    expect(data.searchProducts.edges[0]!.node.variants[0]!.imageAlts).toEqual([f.payload.variants[0]!.images[0]!.alt]);
    const stocks=f.payload.variants.map(v=>({sku:v.sku,stock:v.stock}));
    await productService.upsert(f.productId,{...f.payload,title:"Ficha actualizada por otra persona"},stocks,0);
    await expect(productService.upsert(f.productId,f.payload,stocks,0)).rejects.toThrow(/Otra persona/);
    expect((await productService.get(f.productId))?.title).toBe("Ficha actualizada por otra persona");
  });
  it("solo reduce la compra sugerida con unidades cuya llegada está prevista dentro de la cobertura",()=>{
    const product={id:"p",title:"Producto",categories:[],variants:[{sku:"SKU",stock:0,price:10,reorderPoint:5,flavor:""}]};
    const now=new Date("2026-09-11T12:00:00Z");
    const report=computeManagement([product],[],{year:2026,month:9,coverageDays:7},now,[],[{productId:"p",sku:"SKU",quantity:100,expectedOn:"2026-12-01"},{productId:"p",sku:"SKU",quantity:100},{productId:"p",sku:"SKU",quantity:100,expectedOn:"2026-08-15"},{productId:"p",sku:"SKU",quantity:2,expectedOn:"2026-09-15"}]);
    expect(report.inventory[0]).toMatchObject({inTransit:302,arrivingInTime:2,suggestedOrder:3});
  });
  it("traslada y ajusta exactamente el lote seleccionado aunque comparta nombre con otro vencimiento",async()=>{
    const f=await fixture(0);const target=await supplyService.saveWarehouse(undefined,{name:"Destino de lotes"});
    await productService.changeStock(f.productId,f.sku,3,{lot:"LOTE",expiresOn:"2090-01-01",unitCost:10});
    await productService.changeStock(f.productId,f.sku,4,{lot:"LOTE",expiresOn:"2091-01-01",unitCost:20});
    const move={productId:f.productId,sku:f.sku,from:"main",to:target.id,lot:"LOTE",expiresOn:"2091-01-01",unitCost:20,expectedQuantity:4,quantity:2,reason:"Traslado del lote seleccionado"};
    const {expiresOn,unitCost,...ambiguous}=move;
    await expect(supplyService.transfer(ambiguous)).rejects.toThrow(/varios lotes/);
    await supplyService.transfer(move);
    await expect(supplyService.transfer(move)).rejects.toThrow(/lote cambió/);
    expect((await supplyService.positions()).find(p=>p.productId===f.productId&&p.warehouseId===target.id)).toMatchObject({quantity:2,unitCost:20,expiresOn:"2091-01-01"});
    await productService.adjustStock({productId:f.productId,sku:f.sku,expectedStock:7,delta:-1,reason:"Merma de un lote concreto",position:{warehouseId:target.id,lot:"LOTE",expiresOn:"2091-01-01",unitCost:20}});
    expect((await supplyService.positions()).find(p=>p.productId===f.productId&&p.warehouseId==="main"&&p.expiresOn==="2090-01-01")?.quantity).toBe(3);
  });
  it("rechaza un ajuste si un traslado cambió ese lote aunque el stock total del SKU sea igual",async()=>{
    const f=await fixture(4);const target=await supplyService.saveWarehouse(undefined,{name:"Destino de concurrencia"});
    await supplyService.transfer({productId:f.productId,sku:f.sku,from:"main",to:target.id,lot:"INICIAL",quantity:1,reason:"Movimiento durante conteo"});
    expect(await f.stock()).toBe(4);
    await expect(productService.adjustStock({productId:f.productId,sku:f.sku,expectedStock:4,expectedLotQuantity:4,delta:-1,reason:"Conteo abierto antes del traslado",position:{warehouseId:"main",lot:"INICIAL",expiresOn:"",unitCost:null}})).rejects.toThrow(/lote cambió/);
    expect(await f.stock()).toBe(4);
  });
});
