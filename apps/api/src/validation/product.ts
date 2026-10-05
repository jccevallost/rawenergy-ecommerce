import { z } from "zod";

const taxonomySchema = z.object({ name: z.string().trim().min(2).max(80), slug: z.string().max(160).regex(/^[a-z0-9-]+$/) }).strict();
// Las fotos se suben a /media y aqui solo viaja su URL. Un data URI metia la
// imagen entera dentro del documento del producto y reventaba el limite de
// 16 MB de MongoDB en cuanto las fotos eran reales.
// Imagen aceptable (C60, S20): https, ruta propia o foto de la biblioteca (/media/<id>). Una
// foto de la biblioteca guardada con http (subida desde la API local) se sirve reescrita con
// PUBLIC_API_URL; cualquier otra dirección http produciría contenido mixto en la tienda.
export const IMAGE_URL = /^(https:\/\/[^\s]+|\/(?!\/)[^\s]+|https?:\/\/[^\s/]+\/media\/[a-f0-9]{32}(?:[?#][^\s]*)?)$/i;
const imageSchema = z.object({
  url: z.string().trim().min(1).max(600).refine((value) => IMAGE_URL.test(value), {
    message: "La imagen debe ser de la biblioteca o una dirección https; no se aceptan imágenes incrustadas ni http"
  }),
  alt: z.string().trim().min(1).max(140)
}).strict();
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

// Campos del proyecto anterior que la tienda no usa (C67, V21): puntos, cuotas, envío gratis por
// producto y mensajes comerciales. Un panel publicado antes de este cambio todavía los envía: se
// descartan antes de validar en lugar de rechazar el producto.
const LEGACY_FIELDS = ["vitalCoinsReward", "maxInstallments", "hasFreeShipping", "storeBadges"];
const withoutLegacy = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const copy = { ...(value as Record<string, unknown>) };
  for (const key of LEGACY_FIELDS) delete copy[key];
  return copy;
};

const productPayloadBase = z.object({
  title: z.string().trim().min(3).max(120),
  brand: z.string().trim().min(2).max(80),
  slug: z.string().max(160).regex(/^[a-z0-9-]+$/),
  shortDescription: z.string().trim().min(10).max(320),
  // Datos de la etiqueta (C66, V19): se muestran en la ficha solo si están cargados; vacíos no se inventan.
  ingredients: z.string().trim().max(1500).optional().default(""),
  usage: z.string().trim().max(1000).optional().default(""),
  warnings: z.string().trim().max(1000).optional().default(""),
  productType: z.enum(["SUPPLEMENT", "APPAREL"]).default("SUPPLEMENT"),
  nutritionalFacts: nutritionSchema.nullable().optional(),
  variants: z.array(variantSchema).min(1).max(120).superRefine((variants, ctx) => {
    const skus = variants.map((variant) => variant.sku);
    if (new Set(skus).size !== skus.length) ctx.addIssue({ code: "custom", message: "Los SKU deben ser únicos" });
  }),
  categories: z.array(taxonomySchema).min(1).max(12),
  goals: z.array(taxonomySchema).min(1).max(12),
  featured: z.boolean().default(false)
}).strict().superRefine((product, ctx) => {
  if (product.productType === "SUPPLEMENT" && !product.nutritionalFacts) {
    ctx.addIssue({ code: "custom", path: ["nutritionalFacts"], message: "La información nutricional es obligatoria para suplementos" });
  }
});
export const productPayloadSchema = z.preprocess(withoutLegacy, productPayloadBase);

export type ProductPayload = z.infer<typeof productPayloadSchema>;
