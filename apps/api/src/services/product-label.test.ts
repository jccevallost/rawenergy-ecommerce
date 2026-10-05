import { ApolloServer } from "@apollo/server";
import { describe, expect, it } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { productPayloadSchema } from "../validation/product.js";
import { productService } from "./product.service.js";

// C66 (V19): ingredientes, modo de uso y advertencias de la etiqueta.
describe("Datos de la etiqueta del producto", () => {
  it("se guardan, se leen en la ficha y quedan vacíos si no se cargan", async () => {
    const payload = { ...structuredClone(demoProducts[0]!), slug: "etiqueta-prueba", ingredients: "Proteína de suero aislada, cacao.", usage: "1 medida en 200 ml de agua.", warnings: "Contiene leche." };
    payload.variants = payload.variants.map((variant, index) => ({ ...variant, sku: `ETQ-${index}` }));
    await productService.upsert(undefined, payload);
    const server = new ApolloServer({ typeDefs, resolvers });
    const response = await server.executeOperation({ query: '{ productBySlug(slug:"etiqueta-prueba") { ingredients usage warnings } }' }, { contextValue: { user: null, requestId: "x", ip: "203.0.113.1" } });
    const data = response.body.kind === "single" ? response.body.singleResult.data : null;
    expect(data).toEqual({ productBySlug: { ingredients: "Proteína de suero aislada, cacao.", usage: "1 medida en 200 ml de agua.", warnings: "Contiene leche." } });
    expect(productPayloadSchema.parse({ ...structuredClone(demoProducts[1]!) }).ingredients).toBe("");
    expect(() => productPayloadSchema.parse({ ...structuredClone(demoProducts[1]!), warnings: "x".repeat(1001) })).toThrow();
  });
});
