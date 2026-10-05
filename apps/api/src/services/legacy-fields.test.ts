import { ApolloServer } from "@apollo/server";
import { beforeAll, describe, expect, it } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { productPayloadSchema } from "../validation/product.js";
import { authService, type AuthUser } from "./auth.service.js";

// C67: campos del proyecto anterior retirados de datos, panel y tienda. La tienda y el panel
// publicados antes del cambio todavía los piden y los envían: no deben fallar.
const server = new ApolloServer({ typeDefs, resolvers });
let admin: AuthUser;
const run = async (query: string, variables: Record<string, unknown> = {}, user: AuthUser | null = null) => {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user, requestId: "x", ip: "203.0.113.1" } });
  return response.body.kind === "single" ? response.body.singleResult : { errors: [{ message: "incremental" }] };
};
beforeAll(async () => { authService.setPersistence(false); await authService.bootstrapAdmin(); admin = (await authService.users("ADMIN"))[0]!; });

describe("Campos retirados (C67)", () => {
  it("una tienda anterior que los pide recibe valores fijos y no un error", async () => {
    const result = await run("{ searchProducts(pagination:{first:2}) { edges { node { vitalCoinsReward maxInstallments hasFreeShipping storeBadges } } } }");
    expect(result.errors).toBeUndefined();
    expect((result.data as { searchProducts: { edges: Array<{ node: unknown }> } }).searchProducts.edges[0]!.node).toEqual({ vitalCoinsReward: 0, maxInstallments: 1, hasFreeShipping: false, storeBadges: [] });
    const totals = await run('query($i:[CartItemInput!]!){ calculateCartTotals(cartItems:$i){ total earnedCoins } }', { i: [{ productId: "demo-2", variantSku: "DP-CREATINE-300G", quantity: 1 }] });
    expect(totals.errors).toBeUndefined();
  });
  it("un panel anterior que los envía guarda el producto sin ellos", async () => {
    const payload = { ...structuredClone(demoProducts[3]!), slug: "panel-anterior", vitalCoinsReward: 5, maxInstallments: 3, hasFreeShipping: true, storeBadges: ["Gratis en ordenes seleccionadas"] };
    payload.variants = payload.variants.map((variant, index) => ({ ...variant, sku: `ANT-${index}` }));
    const parsed = productPayloadSchema.parse(payload) as Record<string, unknown>;
    for (const key of ["vitalCoinsReward", "maxInstallments", "hasFreeShipping", "storeBadges"]) expect(parsed).not.toHaveProperty(key);
    const created = await run("mutation($p:JSON!){ createProduct(payload:$p){ id } }", { p: payload }, admin);
    expect(created.errors).toBeUndefined();
  });
});
