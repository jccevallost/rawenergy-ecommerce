import { randomUUID } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { campaignService } from "./campaign.service.js";
import { mailService } from "./mail.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { listMovements } from "./stockLedger.service.js";
import { telegramService } from "./telegram.service.js";
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

const server = new ApolloServer({ typeDefs, resolvers });
const MERGE = "mutation($input: JSON!){ mergeProducts(input: $input) }";
const admin = { id: "admin-merge", name: "Admin", email: "admin@example.test", role: "ADMIN", status: "ACTIVE" };
async function merge(input: Record<string, unknown>, user: unknown = admin) {
  const r = await server.executeOperation({ query: MERGE, variables: { input } }, { contextValue: { user: user as never, requestId: randomUUID(), ip: "198.51.100.9" } });
  if (r.body.kind !== "single") throw new Error("single");
  return r.body.singleResult as { data?: { mergeProducts: { movedSkus: string[]; orders: number; product: { variants: Array<{ sku: string; flavor: string; stock: number }> } } }; errors?: Array<{ message: string; extensions?: { code?: string } }> };
}
const customer = { fullName: "Persona de prueba", email: "union@example.test", phone: "0991234567", province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: "1700000001" };
async function pair() {
  const base = structuredClone(demoProducts[1]!);
  const target = await productService.upsert(undefined, { ...base, slug: `destino-${randomUUID()}`, variants: [{ ...base.variants[0]!, flavor: "Sin sabor", size: { value: 300, unit: "g" }, sku: `D-${randomUUID().slice(0, 8)}`, stock: 10, price: 35 }] }) as { id: string };
  const sourceSku = `O-${randomUUID().slice(0, 8)}`;
  const source = await productService.upsert(undefined, { ...base, title: "Creatina 1 kg", slug: `origen-${randomUUID()}`, variants: [{ ...base.variants[0]!, flavor: "Unflavored", size: { value: 1, unit: "kg" }, sku: sourceSku, stock: 6, price: 55 }] }) as { id: string };
  return { targetId: target.id, sourceId: source.id, sourceSku };
}
beforeAll(() => undefined);

describe("Unir un producto como presentación de otro (C49)", () => {
  it("mueve la presentación con stock, renombra el sabor, archiva el origen y pasa pedidos y campañas", async () => {
    const { targetId, sourceId, sourceSku } = await pair();
    const order = await orderService.create({ idempotencyKey: randomUUID(), customer, items: [{ productId: sourceId, variantSku: sourceSku, quantity: 2 }], shippingMethod: "SERVIENTREGA_NATIONAL", paymentMethod: "BANK_TRANSFER" }) as { id: string };
    const withSource = await campaignService.save(randomUUID(), { slug: `union-${randomUUID().slice(0, 8)}`, title: "Campaña de prueba", eyebrow: "Prueba", message: "Campaña para comprobar la unión de productos.", ctaLabel: "Ver más", theme: "NOCHE", startsOn: "2026-01-01", endsOn: "2026-12-31", active: true, priority: 1, productIds: [sourceId] }, undefined, { id: "admin-merge", name: "Prueba" }).catch((error: Error) => { console.log("campaña:", JSON.stringify(error).slice(0, 400), error.message.slice(0, 300)); return null; });
    const result = await merge({ sourceId, targetId, flavors: { [sourceSku]: "Sin sabor" } });
    expect(result.errors).toBeUndefined();
    const moved = result.data!.mergeProducts;
    expect(moved.movedSkus).toEqual([sourceSku]);
    expect(moved.orders).toBe(1);
    const target = await productService.get(targetId);
    expect(target!.variants.map(v => [v.sku, v.flavor, v.stock])).toContainEqual([sourceSku, "Sin sabor", 4]);
    const source = await productService.get(sourceId);
    expect(source!.active).toBe(false);
    expect(source!.variants.every(v => v.stock === 0 && v.sku.endsWith("-UNIDO"))).toBe(true);
    // Cancelar el pedido devuelve el stock a la presentación, ahora en el destino.
    await orderService.updateStatus(order.id, "CANCELLED", { reason: "Prueba tras unir" });
    expect((await productService.get(targetId))!.variants.find(v => v.sku === sourceSku)!.stock).toBe(6);
    const movements = await listMovements({ sku: sourceSku, limit: 20 });
    expect(JSON.stringify(movements)).toMatch(/Unión de/);
    expect(withSource).not.toBeNull();
    expect((await campaignService.get(withSource!.id))!.productIds).toContain(targetId);
    // Buscar por el tamaño encuentra el producto destino.
    const found = await productService.search({ search: "1 kg" }, { first: 50 });
    expect(found.edges.map(e => String((e.node as { id?: string }).id))).toContain(targetId);
  });

  it("rechaza SKU o combinación sabor/tamaño repetidos, el mismo producto y a quien no es administrador", async () => {
    const { targetId, sourceId } = await pair();
    expect((await merge({ sourceId: targetId, targetId })).errors?.[0]?.message).toMatch(/distintos/);
    const clash = await pair();
    const t = await productService.get(clash.targetId);
    const sameCombo = await productService.upsert(undefined, { ...structuredClone(demoProducts[1]!), slug: `choque-${randomUUID()}`, variants: [{ flavor: t!.variants[0]!.flavor, size: { value: t!.variants[0]!.size.value, unit: t!.variants[0]!.size.unit }, price: 30, stock: 1, sku: `C-${randomUUID().slice(0, 8)}`, images: [] }] }) as { id: string };
    expect((await merge({ sourceId: sameCombo.id, targetId: clash.targetId })).errors?.[0]?.message).toMatch(/ya tendría/);
    expect((await merge({ sourceId, targetId }, { ...admin, role: "CATALOG" })).errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });

  it("respeta la revisión esperada: no une sobre una ficha que cambió", async () => {
    const { targetId, sourceId } = await pair();
    expect((await merge({ sourceId, targetId, targetRevision: 99 })).errors?.[0]?.message).toMatch(/cambió/);
    expect((await productService.get(sourceId))!.active).not.toBe(false);
  });
});
