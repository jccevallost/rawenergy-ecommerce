import { assetManifest } from "virtual:asset-manifest";
import type { Product } from "@vital-forge/shared-logic";

const imageExtensions = ["webp", "png", "jpg"];
// Logos: vectorial primero, luego WebP y por último PNG (C64). Antes ganaba el PNG aunque hubiera otro formato.
const logoExtensions = ["svg", "webp", "png"];

export type FeaturedBrand = {
  name: string;
  asset: string;
};

export const featuredBrands: FeaturedBrand[] = [
  { name: "Dragon Pharma", asset: "dragon-pharma" },
  { name: "Raw Nutrition", asset: "raw-nutrition" },
  { name: "Evogen", asset: "evogen" },
  { name: "MuscleTech", asset: "muscletech" },
  { name: "Nutrex", asset: "nutrex" },
  { name: "Optimum Nutrition", asset: "optimum-nutrition" },
  { name: "Gold Standard", asset: "gold-standard" },
  { name: "Insane Labz", asset: "insane-labz" },
  { name: "Kevin Levrone", asset: "kevin-levrone" },
  { name: "Dymatize", asset: "dymatize" }
];

const slugifyAssetName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

// Solo se proponen rutas de archivos que realmente estan en public/assets.
// Probar a ciegas cada extension convertia cada imagen ausente en una respuesta
// 404 por carga de pagina.
const existing = new Set(assetManifest);

const assetCandidates = (folder: "products" | "brands" | "store", names: string[], extensions: string[]) =>
  unique(names)
    .flatMap((name) => extensions.map((extension) => `/assets/${folder}/${name}.${extension}`))
    .filter((path) => existing.has(path));

export const brandLogoCandidates = (brand: FeaturedBrand) =>
  assetCandidates("brands", [brand.asset, slugifyAssetName(brand.name)], logoExtensions);

/** Logo local de la marca de un producto, si existe: respaldo honesto cuando aún no hay foto. */
export const brandLogoFor = (brandName: string) => {
  const known = featuredBrands.find(brand => brand.name.toLowerCase() === brandName.toLowerCase());
  return assetCandidates("brands", [known?.asset ?? "", slugifyAssetName(brandName)], logoExtensions);
};

export const siteLogoCandidates = () =>
  assetCandidates("store", ["logo", "rawenergy-logo"], logoExtensions);

const productPhotoCandidates = (product?: Product | null) => {
  if (!product) return [];
  return assetCandidates("products", [product.slug, slugifyAssetName(product.title)], imageExtensions);
};

const MEDIA = /\/media\/[a-f0-9]{32}$/;
/** Miniatura de 360 px que la API genera para cada foto de /media (en listas y tarjetas). */
export const thumbnail = (url: string) => MEDIA.test(url) ? `${url}?size=thumb` : url;
/**
 * Tamaños de una foto de la biblioteca para `srcset` (C64): 360, 720 y hasta 1.400 px. El
 * navegador elige según el ancho mostrado y la densidad de la pantalla.
 */
export const mediaSrcSet = (url: string) => {
  const base = url.replace(/\?size=(thumb|medium)$/, "");
  return MEDIA.test(base) ? `${base}?size=thumb 360w, ${base}?size=medium 720w, ${base} 1400w` : undefined;
};

/** Para tarjetas y carriles: miniaturas primero y, si fallan, la foto completa. */
export const productThumbCandidates = (product?: Product | null) => {
  const full = productImageCandidates(product);
  return unique([...full.map(thumbnail), ...full]);
};

export const productImageCandidates = (product?: Product | null) => {
  const variantImage = product?.variants[0]?.images?.[0]?.url ?? product?.variants[0]?.imageUrls?.[0];
  return unique([
    product?.primaryImage?.url ?? "",
    variantImage ?? "",
    ...productPhotoCandidates(product)
  ]);
};
