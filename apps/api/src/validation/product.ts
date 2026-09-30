import { z } from "zod";

const taxonomySchema = z.object({ name: z.string().trim().min(2).max(80), slug: z.string().max(160).regex(/^[a-z0-9-]+$/) }).strict();
// Las fotos se suben a /media y aqui solo viaja su URL. Un data URI metia la
// imagen entera dentro del documento del producto y reventaba el limite de
// 16 MB de MongoDB en cuanto las fotos eran reales.
const imageSchema = z.object({
  url: z.string().trim().min(1).max(600).refine((value) => /^(https?:\/\/|\/(?!\/))[^\s]+$/i.test(value), {
    message: "La imagen debe subirse al servidor: no se aceptan imagenes incrustadas"
  }),
  alt: z.string().trim().min(1).max(140)
}).strict();
const defaultStoreBadges = ["Express 4h Quito y Valles", "Gratis en ordenes seleccionadas", "Producto original asegurado"];
const variantSchema = z.object({
  flavor: z.string().trim().min(1).max(80),
  size: z.object({ value: z.number().positive(), unit: z.string().trim().min(1).max(12) }).strict(),
  // Una variante sin precio no se puede vender y arrastra el "desde" del
  // catalogo a cero. Antes la matriz generaba las combinaciones que faltaban
  // con precio 0 y se publicaban tal cual.
  price: z.number().positive().max(1000000),
  compareAtPrice: z.number().nonnegative().max(1000000).nullable().optional(),
  reorderPoint: z.number().int().nonnegative().max(100000).default(5).optional(),
  stock: z.number().int().nonnegative().max(1000000),
  sku: z.string().trim().min(3).max(80),
  images: z.array(imageSchema).max(8).default([])
}).strict();
// null = la etiqueta no declara ese valor. Poner 0 afirmaría algo que el
// fabricante no dice (creatinas, preentrenos y cápsulas suelen omitirlos).
const declared = z.number().nonnegative().nullable();
const nutritionSchema = z.object({
  servingSize: z.string().trim().min(1).max(80), calories: declared, protein: declared,
  carbohydrates: declared, fats: declared
}).strict();

export const productPayloadSchema = z.object({
  title: z.string().trim().min(3).max(120),
  brand: z.string().trim().min(2).max(80),
  slug: z.string().max(160).regex(/^[a-z0-9-]+$/),
  shortDescription: z.string().trim().min(10).max(320),
  productType: z.enum(["SUPPLEMENT", "APPAREL"]).default("SUPPLEMENT"),
  nutritionalFacts: nutritionSchema.nullable().optional(),
  variants: z.array(variantSchema).min(1).max(120).superRefine((variants, ctx) => {
    const skus = variants.map((variant) => variant.sku);
    if (new Set(skus).size !== skus.length) ctx.addIssue({ code: "custom", message: "Los SKU deben ser únicos" });
  }),
  categories: z.array(taxonomySchema).min(1).max(12),
  goals: z.array(taxonomySchema).min(1).max(12),
  vitalCoinsReward: z.number().int().nonnegative().default(0),
  maxInstallments: z.number().int().min(1).max(24).default(1),
  hasFreeShipping: z.boolean().default(false),
  storeBadges: z.array(z.string().trim().min(3).max(72)).max(5).default(defaultStoreBadges),
  featured: z.boolean().default(false)
}).strict().superRefine((product, ctx) => {
  if (product.productType === "SUPPLEMENT" && !product.nutritionalFacts) {
    ctx.addIssue({ code: "custom", path: ["nutritionalFacts"], message: "La información nutricional es obligatoria para suplementos" });
  }
});

export type ProductPayload = z.infer<typeof productPayloadSchema>;
