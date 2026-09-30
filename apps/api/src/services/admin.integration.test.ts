import { ApolloServer } from "@apollo/server";
import depthLimit from "graphql-depth-limit";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { authService, type AuthUser } from "./auth.service.js";
import { productService } from "./product.service.js";
import { demoProducts } from "../data/demoProducts.js";
import { auditService } from "./audit.service.js";
import { mailService } from "./mail.service.js";
import { telegramService } from "./telegram.service.js";
import { env } from "../config/env.js";
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(mailService, "sendStatusUpdate").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);
const server = new ApolloServer({ typeDefs, resolvers, validationRules: [depthLimit(4)] });
let admin: AuthUser;
async function execute(query: string, variables: Record<string, unknown> = {}, user: AuthUser | null = admin) {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user, requestId: crypto.randomUUID(), ip: "127.0.0.1" } });
  if (response.body.kind !== "single") throw new Error("Expected single result");
  return response.body.singleResult;
}
beforeAll(async () => { authService.setPersistence(false); await authService.bootstrapAdmin(); admin = (await authService.users("ADMIN"))[0]!; });
describe("Contrato administrativo y auditoría", () => {
  it("aplica los permisos de catálogo, inventario y gerencia en la API", async () => {
    for (const role of ["CATALOG", "WAREHOUSE", "MANAGER"] as const) {
      const user=await authService.saveAccount(admin,undefined,{name:role,email:`${role.toLowerCase()}@example.com`,password:"Test-role-123",role,status:"ACTIVE"});
      expect((await execute('{ staffHome }',{},user)).errors).toBeUndefined();
      expect((await execute('{ databaseRecords(entity:"users") }',{},user)).errors).toBeDefined();
      expect(Boolean((await execute('{ managementDashboard(filters:{year:2026}) }',{},user)).errors)).toBe(role!=="MANAGER");
      expect(Boolean((await execute('{ inventoryOverview(filters:{year:2026}) }',{},user)).errors)).toBe(role==="CATALOG");
      const mutation=await execute('mutation { saveSupplier(input:{name:"Proveedor por rol"}) }',{},user);
      expect(Boolean(mutation.errors)).toBe(role!=="WAREHOUSE");
      const payload=structuredClone(demoProducts[1]!);payload.slug=`role-product-${role.toLowerCase()}`;payload.variants[0]!.stock=0;
      const create=await execute('mutation($payload:JSON!){createProduct(payload:$payload){id}}',{payload},user);
      expect(Boolean(create.errors)).toBe(role!=="CATALOG");
      if(role==="CATALOG"){
        payload.slug+="-stock";payload.variants[0]!.stock=10;
        expect((await execute('mutation($payload:JSON!){createProduct(payload:$payload){id}}',{payload},user)).errors?.[0]?.message).toMatch(/existencias/);
        expect((await execute('{databaseRecords(entity:"media")}',{},user)).errors).toBeUndefined();
      }
    }
  });
  it("recupera contraseña con enlace de un solo uso y revoca sesiones sin publicar secretos",async()=>{
    const priorUrl=env.ADMIN_APP_URL;env.ADMIN_APP_URL="https://admin.example.com";
    const enabled=vi.spyOn(mailService,"enabled","get").mockReturnValue(true);const delivery=vi.spyOn(mailService,"sendPasswordReset").mockResolvedValue(true);
    try{
      const account=await authService.saveAccount(admin,undefined,{name:"Recuperación",email:"recover@example.com",password:"Previous-123",role:"CATALOG",status:"ACTIVE"});
      const session=await authService.login({email:account.email,password:"Previous-123"});
      const me=await authService.me(session.token);expect((await authService.sessions(me!)).sessions[0]?.current).toBe(true);
      const reply=await execute('mutation($email:String!){requestPasswordReset(email:$email)}',{email:account.email},null);
      expect(reply.errors).toBeUndefined();expect(delivery).toHaveBeenCalledTimes(1);
      const link=delivery.mock.calls[0]![1];const token=new URL(link).hash.slice(7);
      await execute('mutation($email:String!){requestPasswordReset(email:$email)}',{email:account.email},null);expect(delivery).toHaveBeenCalledTimes(1);
      const reset=await execute('mutation($token:String!,$password:String!){resetPassword(token:$token,password:$password)}',{token,password:"Next-secret-123"},null);expect(reset.errors).toBeUndefined();
      expect(await authService.me(session.token)).toBeNull();await expect(authService.resetPassword(token,"Again-secret-123")).rejects.toThrow();
      const events=await auditService.list({search:"resetPassword"});expect(JSON.stringify(events)).not.toContain(token);expect(JSON.stringify(events)).not.toContain("Next-secret-123");
      const next=await authService.login({email:account.email,password:"Next-secret-123"});await authService.revokeSessions((await authService.me(next.token))!);expect(await authService.me(next.token)).toBeNull();
    }finally{env.ADMIN_APP_URL=priorUrl;enabled.mockRestore();delivery.mockRestore();}
  });
  it("rechaza permisos obsoletos al modificar administradores simultáneamente",async()=>{
    const first=await authService.saveAccount(admin,undefined,{name:"Administrador A",email:"admin-a@example.com",password:"Secret-admin-A",role:"ADMIN",status:"ACTIVE"});
    const second=await authService.saveAccount(admin,undefined,{name:"Administrador B",email:"admin-b@example.com",password:"Secret-admin-B",role:"ADMIN",status:"ACTIVE"});
    const results=await Promise.allSettled([authService.setUserRole(first,second.id,"MANAGER"),authService.setUserRole(second,first.id,"MANAGER")]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  });
  it("cerrar una sesión conserva las otras sesiones vigentes",async()=>{
    const account=await authService.saveAccount(admin,undefined,{name:"Sesiones",email:"sessions@example.com",password:"Session-test-123",role:"CATALOG",status:"ACTIVE"});
    const a=await authService.login({email:account.email,password:"Session-test-123"});const b=await authService.login({email:account.email,password:"Session-test-123"});
    await authService.endSession((await authService.me(a.token))!);expect(await authService.me(a.token)).toBeNull();expect(await authService.me(b.token)).toBeTruthy();
  });
  it("deniega consultas sensibles a invitados y clientes", async () => {
    const customer = (await authService.register({ name: "Cliente prueba", email: "customer-test@example.com", password: "Test1234!" })).user;
    for (const user of [null, customer]) {
      for (const query of ['{ managementDashboard(filters: {year: 2026}) }', '{ auditEvents }', '{ accounts }', '{ databaseRecords(entity: "users") }']) expect((await execute(query, {}, user)).errors).toBeDefined();
    }
  });
  it("crea, modifica y bloquea cuentas; revoca la sesión previa y no publica secretos", async () => {
    const input = { name: "Operador prueba", email: "operator-test@example.com", password: "Secret-test-123", role: "CUSTOMER", status: "ACTIVE" };
    const created = await execute('mutation($input: JSON!) { saveAccount(input: $input) { id name email } }', { input });
    expect(created.errors).toBeUndefined();
    const id = (created.data?.saveAccount as { id: string }).id;
    const session = await authService.login({ email: input.email, password: input.password });
    const changed = await execute('mutation($id: ID!, $input: JSON!) { saveAccount(id: $id, input: $input) { id name email status } }', { id, input: { ...input, name: "Editado", password: "New-secret-123" } });
    expect(changed.errors).toBeUndefined(); expect(await authService.me(session.token)).toBeNull();
    await expect(authService.login({ email: input.email, password: input.password })).rejects.toThrow();
    const records = await execute('{ databaseRecords(entity: "users") }');
    expect(JSON.stringify(records)).not.toMatch(/passwordHash|scrypt:|sessionVersion|Secret-test/);
    const audit = await auditService.list({ search: id });
    expect(JSON.stringify(audit)).not.toMatch(/Secret-test-123|New-secret-123/);
    expect(audit.rows.some((r) => r.status === "SUCCESS")).toBe(true);
    const own = await execute('mutation($id: ID!, $input: JSON!) { saveAccount(id: $id, input: $input) { id } }', { id: admin.id, input: { name: admin.name, email: admin.email, role: "CUSTOMER", status: "BLOCKED" } });
    expect(own.errors).toBeDefined();
    const blocked = await execute('mutation($id: ID!, $input: JSON!) { saveAccount(id: $id, input: $input) { status } }', { id, input: { name: "Editado", email: input.email, role: "CUSTOMER", status: "BLOCKED" } });
    expect(blocked.errors).toBeUndefined();
    await expect(authService.login({ email: input.email, password: "New-secret-123" })).rejects.toThrow();
  });
  it("evita sobrescribir stock desactualizado y conserva imágenes y mínimos", async () => {
    const payload = structuredClone(demoProducts[1]!); payload.slug = "integration-product";
    const created = await execute('mutation($payload: JSON!) { upsertProduct(payload: $payload) { id } }', { payload });
    expect(created.errors).toBeUndefined(); const id = (created.data?.upsertProduct as { id: string }).id;
    const stocks = payload.variants.map((v) => ({ sku: v.sku, stock: v.stock }));
    const adjustment = await execute('mutation($input: JSON!) { adjustStock(input: $input) }', { input: { productId: id, sku: stocks[0]!.sku, expectedStock: stocks[0]!.stock, delta: -1, reorderPoint: 8, reason: "Conteo de prueba" } });
    expect(adjustment.errors).toBeUndefined();
    const conflict = await execute('mutation($id: ID!, $payload: JSON!, $expectedStocks: JSON) { upsertProduct(id: $id, payload: $payload, expectedStocks: $expectedStocks, expectedRevision: 0) { id } }', { id, payload, expectedStocks: stocks });
    expect(conflict.errors?.[0]?.message).toMatch(/inventario cambió/i);
    const current = await productService.get(id); expect(current?.variants[0]?.stock).toBe(stocks[0]!.stock - 1);
    expect(current?.variants[0]?.reorderPoint).toBe(8);
    const audit = await auditService.list({ search: id }); expect(audit.rows.some((r) => r.status === "FAILED")).toBe(true);
    const success = audit.rows.find((r) => r.action === "adjustStock" && r.status === "SUCCESS"); expect(success?.before).toBeTruthy(); expect(success?.after).toBeTruthy();
  });
  it("registra fallos de acceso sin guardar contraseñas", async () => {
    const result = await execute('mutation($input: LoginInput!) { login(input: $input) { token } }', { input: { email: "nobody@example.com", password: "DoNotLogThis" } }, null);
    expect(result.errors).toBeDefined(); const events = await auditService.list({ search: "login" });
    expect(JSON.stringify(events)).not.toContain("DoNotLogThis"); expect(events.rows.some((r) => r.status === "FAILED")).toBe(true);
  });
});
