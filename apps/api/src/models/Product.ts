import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { sellablePriceRange } from "../lib/priceRange.js";

const { Schema, model, models } = mongoose;

const taxonomySchema = new Schema({ name: { type: String, required: true }, slug: { type: String, required: true } }, { _id: false });
const imageSchema = new Schema({ url: { type: String, required: true }, alt: { type: String, required: true } }, { _id: false });
const sizeSchema = new Schema({ value: { type: Number, required: true }, unit: { type: String, required: true } }, { _id: false });
const defaultStoreBadges = ["Express 4h Quito y Valles", "Gratis en ordenes seleccionadas", "Producto original asegurado"];
const variantSchema = new Schema({
  flavor: { type: String, required: true },
  size: { type: sizeSchema, required: true },
  price: { type: Number, required: true, min: 0 },
  compareAtPrice: { type: Number, min: 0 },
  reorderPoint: { type: Number, default: 5, min: 0 },
  stock: { type: Number, required: true, min: 0 },
  sku: { type: String, required: true },
  lots: { type: [{ warehouseId: String, lot: String, expiresOn: String, quantity: Number, unitCost: { type: Number, default: null }, _id: false }], default: [] },
  images: { type: [imageSchema], default: [] }
});
const nutritionSchema = new Schema({
  servingSize: String,
  calories: { type: Number, min: 0 },
  protein: { type: Number, min: 0 },
  carbohydrates: { type: Number, min: 0 },
  fats: { type: Number, min: 0 }
}, { _id: false });

const productSchema = new Schema({
  revision: { type: Number, default: 0 },
  title: { type: String, required: true, trim: true },
  brand: { type: String, required: true, index: true },
  slug: { type: String, required: true, unique: true, index: true },
  shortDescription: { type: String, required: true },
  productType: { type: String, enum: ["SUPPLEMENT", "APPAREL"], default: "SUPPLEMENT" },
  nutritionalFacts: nutritionSchema,
  priceRange: {
    min: { type: Number, required: true, min: 0 },
    max: { type: Number, required: true, min: 0 }
  },
  variants: { type: [variantSchema], required: true, validate: [(value: unknown[]) => value.length > 0, "Debe existir una variante"] },
  categories: { type: [taxonomySchema], default: [], index: true },
  goals: { type: [taxonomySchema], default: [], index: true },
  vitalCoinsReward: { type: Number, default: 0, min: 0 },
  maxInstallments: { type: Number, default: 1, min: 1, max: 24 },
  hasFreeShipping: { type: Boolean, default: false },
  storeBadges: { type: [String], default: defaultStoreBadges },
  featured: { type: Boolean, default: false },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true, optimisticConcurrency: true });

productSchema.pre("validate", function () {
  if (this.variants.length) this.priceRange = sellablePriceRange(this.variants);
  if (this.productType === "APPAREL") this.nutritionalFacts = undefined;
});

productSchema.index({ title: "text", brand: "text", shortDescription: "text" });
productSchema.index({ "goals.slug": 1, featured: -1 });
productSchema.index({ active: 1, "priceRange.min": 1, _id: 1 });
productSchema.index({ active: 1, "priceRange.min": -1, _id: 1 });

export type ProductDocument = InferSchemaType<typeof productSchema>;
export const ProductModel = (models.Product ?? model<ProductDocument>("Product", productSchema)) as Model<ProductDocument>;
