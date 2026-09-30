import { randomUUID } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import depthLimit from "graphql-depth-limit";
import { beforeAll, describe, expect, it } from "vitest";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { operationWidthRule } from "../graphql/validationRules.js";
import { suggestedCampaigns } from "../data/suggestedCampaigns.js";
import { demoProducts } from "../data/demoProducts.js";
import { authService, type AuthUser } from "./auth.service.js";
import { campaignService, campaignStatus, ecuadorToday } from "./campaign.service.js";
import { productService } from "./product.service.js";

const server = new ApolloServer({ typeDefs, resolvers, validationRules: [depthLimit(4), operationWidthRule] });
let admin: AuthUser;
let warehouse: AuthUser;
async function execute(query: string, variables: Record<string, unknown> = {}, user: AuthUser | null = admin) {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user, requestId: randomUUID(), ip: `10.0.0.${Math.floor(Math.random() * 200)}` } });
  if (response.body.kind !== "single") throw new Error("Expected single result");
  return response.body.singleResult;
}
const actor = { id: "admin", name: "Admin" };
const input = (overrides: Record<string, unknown> = {}) => ({
  slug: `campana-${randomUUID().slice(0, 8)}`, title: "Campaña de prueba", eyebrow: "Prueba", message: "Selección de prueba para la portada.",
  ctaLabel: "Ver selección", theme: "NOCHE", startsOn: "2026-01-01", endsOn: "2030-12-31", active: true, priority: 50, goals: ["energia"], ...overrides
});
const SAVE = "mutation($id:ID!,$input:JSON!,$revision:Int){saveCampaign(id:$id,input:$input,revision:$revision)}";

beforeAll(async () => {
  authService.setPersistence(false); await authService.bootstrapAdmin();
  admin = (await authService.users("ADMIN"))[0]!;
  warehouse = await authService.saveAccount(admin, undefined, { name: "Bodega", email: `bodega-${randomUUID().slice(0, 6)}@example.com`, password: "Test-role-123", role: "WAREHOUSE", status: "ACTIVE" });
});

describe("Campañas", () => {
  it("las sugeridas son válidas, se cargan una sola vez y cubren la temporada actual", async () => {
    expect(await campaignService.bootstrap()).toBe(suggestedCampaigns.length);
    expect(await campaignService.bootstrap()).toBe(0);
    const live = await campaignService.live("2026-09-26");
    expect(live[0]?.slug).toBe("vuelve-a-tu-rutina");
    expect(live.map(campaign => campaign.slug)).not.toContain("regala-energia");
    expect((await campaignService.live("2026-12-10")).map(campaign => campaign.slug)).toContain("regala-energia");
    for (const campaign of suggestedCampaigns) expect(`${campaign.title} ${campaign.message}`).not.toMatch(/descuento|%|gratis|oferta|garantiza|mejor precio/i);
  });

  it("calcula el estado por fecha de Ecuador y pausa", () => {
    const base = { active: true, startsOn: "2026-10-01", endsOn: "2026-10-31" };
    expect(campaignStatus(base, "2026-09-30")).toBe("SCHEDULED");
    expect(campaignStatus(base, "2026-10-01")).toBe("LIVE");
    expect(campaignStatus(base, "2026-10-31")).toBe("LIVE");
    expect(campaignStatus(base, "2026-11-01")).toBe("ENDED");
    expect(campaignStatus({ ...base, active: false }, "2026-10-15")).toBe("PAUSED");
    // 23:30 del 30 de septiembre en Ecuador ya es 1 de octubre en UTC.
    expect(ecuadorToday(Date.parse("2026-10-01T04:30:00Z"))).toBe("2026-09-30");
  });

  it("valida fechas, selección, identificador único y revisión", async () => {
    const id = randomUUID();
    await expect(campaignService.save(randomUUID(), input({ startsOn: "2026-12-01", endsOn: "2026-11-01" }), undefined, actor)).rejects.toThrow();
    await expect(campaignService.save(randomUUID(), input({ goals: [], brands: [], productIds: [] }), undefined, actor)).rejects.toThrow();
    await expect(campaignService.save(randomUUID(), input({ imageUrl: "javascript:alert(1)" }), undefined, actor)).rejects.toThrow();
    const saved = await campaignService.save(id, input({ slug: "campana-unica" }), undefined, actor);
    await expect(campaignService.save(randomUUID(), input({ slug: "campana-unica" }), undefined, actor)).rejects.toThrow(/identificador/);
    await expect(campaignService.save(id, input({ slug: "campana-unica" }), undefined, actor)).rejects.toThrow(/ya existe/);
    const edited = await campaignService.save(id, input({ slug: "campana-unica", title: "Título editado" }), saved.revision, actor);
    expect(edited.revision).toBe(1);
    await expect(campaignService.save(id, input({ slug: "campana-unica" }), saved.revision, actor)).rejects.toThrow(/Otra persona/);
    await expect(campaignService.remove(id, 0)).rejects.toThrow();
    expect(await campaignService.remove(id, 1)).toBe(true);
  });

  it("muestra primero los productos elegidos y solo productos vendibles con existencias", async () => {
    const payload = structuredClone(demoProducts[3]!); payload.slug = `archivado-${randomUUID().slice(0, 6)}`; payload.variants = payload.variants.map(variant => ({ ...variant, sku: `${variant.sku}-${randomUUID().slice(0, 4)}` }));
    const archived = await productService.upsert(undefined, payload) as { id: string };
    await productService.archive(archived.id);
    const picked = (await productService.search({ goals: ["recuperacion"] }, { first: 1 })).edges[0]!.node as { id: string };
    const campaign = await campaignService.save(randomUUID(), input({ goals: ["desarrollo-muscular"], productIds: [picked.id, archived.id] }), undefined, actor);
    const products = await campaignService.products(campaign, 24) as Array<{ id: string; variants: Array<{ stock: number }>; goals: Array<{ slug: string }> }>;
    expect(products[0]!.id).toBe(picked.id);
    expect(products.map(product => product.id)).not.toContain(archived.id);
    expect(products.slice(1).every(product => product.goals.some(goal => goal.slug === "desarrollo-muscular") && product.variants.some(variant => variant.stock > 0))).toBe(true);
    expect(new Set(products.map(product => product.id)).size).toBe(products.length);
    expect((await campaignService.products(campaign, 2)).length).toBeLessThanOrEqual(2);
  });

  it("la tienda solo ve campañas activas y vigentes, con productos reales", async () => {
    const paused = await campaignService.save(randomUUID(), input({ active: false, priority: 100 }), undefined, actor);
    const future = await campaignService.save(randomUUID(), input({ startsOn: "2030-01-01", priority: 100 }), undefined, actor);
    const result = await execute("{ activeCampaigns { slug theme products(limit: 3) { id title variants { sku stock } primaryImage { url } } } }", {}, null);
    expect(result.errors).toBeUndefined();
    const slugs = (result.data as { activeCampaigns: Array<{ slug: string; products: unknown[] }> }).activeCampaigns.map(campaign => campaign.slug);
    expect(slugs).not.toContain(paused.slug);
    expect(slugs).not.toContain(future.slug);
    const one = await execute("query($slug:String!){ campaign(slug:$slug) { title products { id } } }", { slug: "encuentra-tu-suplemento" }, null);
    expect((one.data as { campaign: { products: unknown[] } }).campaign.products.length).toBeGreaterThan(0);
    const hidden = await execute("query($slug:String!){ campaign(slug:$slug) { title } }", { slug: paused.slug }, null);
    expect((hidden.data as { campaign: unknown }).campaign).toBeNull();
  });

  it("solo catálogo o administración crean y consultan campañas desde el panel", async () => {
    expect((await execute(SAVE, { id: randomUUID(), input: input() }, null)).errors?.[0]).toBeDefined();
    expect((await execute(SAVE, { id: randomUUID(), input: input() }, warehouse)).errors?.[0]).toBeDefined();
    expect((await execute("{ adminCampaigns }", {}, null)).errors?.[0]).toBeDefined();
    const created = await execute(SAVE, { id: randomUUID(), input: input() });
    expect(created.errors).toBeUndefined();
    const list = await execute("{ adminCampaigns }");
    expect((list.data as { adminCampaigns: { rows: Array<{ status: string }> } }).adminCampaigns.rows.some(row => row.status === "LIVE")).toBe(true);
  });
});

describe("Destacados desde el panel", () => {
  const FEATURE = "mutation($id:ID!,$featured:Boolean!,$revision:Int!){setProductFeatured(id:$id,featured:$featured,revision:$revision){id featured revision}}";
  it("marca y quita destacados con permiso y revisión vigente, y la tienda lo refleja", async () => {
    const payload = structuredClone(demoProducts[4]!); payload.slug = `destacar-${randomUUID().slice(0, 6)}`; payload.featured = false; payload.variants = payload.variants.map(variant => ({ ...variant, sku: `${variant.sku}-${randomUUID().slice(0, 4)}` }));
    const product = await productService.upsert(undefined, payload) as { id: string };
    expect((await execute(FEATURE, { id: product.id, featured: true, revision: 0 }, null)).errors?.[0]).toBeDefined();
    expect((await execute(FEATURE, { id: product.id, featured: true, revision: 0 }, warehouse)).errors?.[0]).toBeDefined();
    const marked = await execute(FEATURE, { id: product.id, featured: true, revision: 0 });
    expect(marked.data).toEqual({ setProductFeatured: { id: product.id, featured: true, revision: 1 } });
    expect((await execute(FEATURE, { id: product.id, featured: false, revision: 0 })).errors?.[0]?.message).toMatch(/Otra persona/);
    const store = await execute("{ searchProducts(filters:{featured:true}, pagination:{first:100}) { edges { node { id } } } }", {}, null);
    expect((store.data as { searchProducts: { edges: Array<{ node: { id: string } }> } }).searchProducts.edges.map(edge => edge.node.id)).toContain(product.id);
    await execute(FEATURE, { id: product.id, featured: false, revision: 1 });
    expect((await productService.get(product.id) as { featured?: boolean }).featured).toBe(false);
  });
});
