import type { Product, VariantDraft } from "@vital-forge/shared-logic";

export type FormState = {
  sourceRevision?: number;
  sourceStocks?: Array<{sku: string; stock: number}>;
  title: string;
  brand: string;
  slug: string;
  description: string;
  productType: "SUPPLEMENT" | "APPAREL";
  flavors: string[];
  sizes: string[];
  categories: string;
  goals: string[];
  /** null = la etiqueta no declara el valor (campo vacío en el formulario). */
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  servingSize: string;
  coins: number;
  installments: number;
  freeShipping: boolean;
  storeBadges: string;
  featured: boolean;
  variants: VariantDraft[];
};

export const initial: FormState = {
  title: "",
  brand: "",
  slug: "",
  description: "",
  productType: "SUPPLEMENT",
  flavors: ["Natural"],
  sizes: ["2 lb"],
  categories: "",
  goals: [],
  calories: null,
  protein: null,
  carbs: null,
  fats: null,
  servingSize: "",
  coins: 0,
  installments: 1,
  freeShipping: false,
  storeBadges: "Express 4h Quito y Valles, Gratis en ordenes seleccionadas, Producto original asegurado",
  featured: false,
  variants: []
};


export const parseSize = (raw: string) => {
  const match = raw.trim().match(/^(\d+(?:[.,]\d+)?)\s*([^\d.,\s].*)$/);
  return match ? { value: Number(match[1]!.replace(",", ".")), unit: match[2]!.trim() }
    : { value: /^\d/.test(raw.trim()) ? Number.NaN : 1, unit: raw.trim() };
};
export const slugify = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const ref = (name: string) => ({ name: name.trim(), slug: slugify(name) });
const variantLabel = (variant: VariantDraft) => `${variant.size.value} ${variant.size.unit}`;
export const listFromText = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
const normalizeGoals = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : listFromText(String(value ?? ""));
export const normalizeForm = (value: FormState & { goals: unknown }): FormState => ({ ...value, goals: normalizeGoals(value.goals) });

export function recoverProductDraft(base: FormState, draft: FormState): FormState {
  const restored = normalizeForm({ ...base, ...draft });
  // Borradores anteriores no guardaban el saldo leído. No conviertas un saldo
  // histórico en un ajuste contra las existencias actuales.
  if (base.sourceStocks && !draft.sourceStocks) {
    restored.sourceStocks = base.sourceStocks;
    restored.variants = restored.variants.map(variant => ({
      ...variant, stock: base.sourceStocks!.find(item => item.sku === variant.sku)?.stock ?? 0
    }));
  }
  return restored;
}

export function productToForm(product: Product): FormState {
  const variants: VariantDraft[] = product.variants.map((variant) => ({
    flavor: variant.flavor,
    // La API entrega estos campos planos; el formulario los necesita anidados.
    size: { value: variant.size?.value ?? variant.sizeValue ?? 0, unit: variant.size?.unit ?? variant.sizeUnit ?? "" },
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    stock: variant.stock,
    reorderPoint: variant.reorderPoint ?? 5,
    sku: variant.sku,
    images: (variant.images
      ?? variant.imageUrls?.map((url, index) => ({ url, alt: variant.imageAlts?.[index] ?? variant.sku }))
      ?? (product.primaryImage ? [product.primaryImage] : [])).map(({ url, alt }) => ({ url, alt }))
  }));
  return {
    sourceRevision: product.revision ?? 0,
    sourceStocks: product.variants.map(({sku, stock}) => ({sku, stock})),
    title: product.title,
    brand: product.brand,
    slug: product.slug,
    description: product.shortDescription,
    productType: product.productType,
    flavors: [...new Set(variants.map((variant) => variant.flavor))],
    sizes: [...new Set(variants.map(variantLabel))],
    categories: product.categories.map((item) => item.name).join(", "),
    goals: product.goals.map((item) => item.name),
    calories: product.nutritionalFacts?.calories ?? null,
    protein: product.nutritionalFacts?.protein ?? null,
    carbs: product.nutritionalFacts?.carbohydrates ?? null,
    fats: product.nutritionalFacts?.fats ?? null,
    servingSize: product.nutritionalFacts?.servingSize ?? "",
    coins: product.vitalCoinsReward,
    installments: product.maxInstallments,
    freeShipping: product.hasFreeShipping,
    storeBadges: (product.storeBadges ?? []).join(", "),
    featured: product.featured ?? false,
    variants
  };
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

/** Validate stored data before it reaches controls that expect arrays and nested images. */
export function isProductForm(value: unknown): value is FormState {
  if (!record(value)) return false;
  if (!["title", "brand", "slug", "description", "categories", "servingSize", "storeBadges"].every(key => typeof value[key] === "string")) return false;
  if (!["coins", "installments"].every(key => finite(value[key]))) return false;
  if (!["calories", "protein", "carbs", "fats"].every(key => value[key] === null || finite(value[key]))) return false;
  if (value.sourceRevision !== undefined && (!finite(value.sourceRevision) || !Number.isInteger(value.sourceRevision) || value.sourceRevision < 0)) return false;
  if (value.sourceStocks !== undefined && (!Array.isArray(value.sourceStocks) || !value.sourceStocks.every(item => record(item) && typeof item.sku === "string" && finite(item.stock) && Number.isInteger(item.stock) && item.stock >= 0))) return false;
  if (value.productType !== "SUPPLEMENT" && value.productType !== "APPAREL") return false;
  if (typeof value.freeShipping !== "boolean" || typeof value.featured !== "boolean") return false;
  if (![value.flavors, value.sizes, value.goals].every(strings)) return false;
  return Array.isArray(value.variants) && value.variants.length <= 120 && value.variants.every(variant =>
    record(variant) && typeof variant.flavor === "string" && typeof variant.sku === "string" &&
    record(variant.size) && finite(variant.size.value) && typeof variant.size.unit === "string" &&
    finite(variant.price) && finite(variant.stock) &&
    (variant.compareAtPrice == null || finite(variant.compareAtPrice)) &&
    (variant.reorderPoint === undefined || finite(variant.reorderPoint)) &&
    Array.isArray(variant.images) && variant.images.length <= 8 && variant.images.every(photo =>
      record(photo) && typeof photo.url === "string" && typeof photo.alt === "string"));
}

const inRange = (value: number, min: number, max = Number.MAX_SAFE_INTEGER) => Number.isFinite(value) && value >= min && value <= max;
const integerInRange = (value: number, min: number, max?: number) => Number.isInteger(value) && inRange(value, min, max);
const textInRange = (value: string, min: number, max: number) => value.trim().length >= min && value.trim().length <= max;

/** The editor is not a native form: numeric constraints must also run on save. */
export function validateProductForm(form: FormState): string[] {
  const errors: string[] = [];
  if (!textInRange(form.title, 3, 120)) errors.push("Nombre: escribe entre 3 y 120 caracteres");
  if (!textInRange(form.brand, 2, 80)) errors.push("Marca: escribe entre 2 y 80 caracteres");
  if (!/^[a-z0-9-]{1,160}$/.test(form.slug)) errors.push("Identificador del enlace: usa letras minúsculas, números y guiones (máximo 160 caracteres)");
  if (!textInRange(form.description, 10, 320)) errors.push("Descripción: escribe entre 10 y 320 caracteres");
  for (const [name, values] of [["Categorías", listFromText(form.categories)], ["Objetivos", form.goals]] as const) {
    if (!values.length || values.length > 12 || values.some(value => !textInRange(value, 2, 80) || !slugify(value))) errors.push(`${name}: agrega de 1 a 12 opciones de entre 2 y 80 caracteres`);
  }
  if (form.productType === "SUPPLEMENT") {
    if (!form.servingSize.trim()) errors.push("Completa el tamaño de la porción");
    if (![form.calories, form.protein, form.carbs, form.fats].every(value => value === null || inRange(value, 0))) errors.push("Información nutricional: usa números positivos o cero, o deja vacío lo que la etiqueta no declara");
  }
  if (!integerInRange(form.coins, 0, 2147483647)) errors.push("Energy Points: ingresa un número entero positivo o cero (máximo 2147483647)");
  if (!integerInRange(form.installments, 1, 24)) errors.push("Cuotas: elige un número entero entre 1 y 24");
  const badges = listFromText(form.storeBadges);
  if (badges.length > 5 || badges.some(value => !textInRange(value, 3, 72))) errors.push("Mensajes comerciales: máximo 5 mensajes de entre 3 y 72 caracteres");
  if (!form.variants.length || form.variants.length > 120) errors.push("Agrega entre 1 y 120 variantes antes de publicar");
  const skus = new Set<string>();
  form.variants.forEach((variant, index) => {
    const label = `Variante ${index + 1} (${variant.flavor || "sin opción"})`;
    const sku = variant.sku.trim();
    if (!textInRange(sku, 3, 80)) errors.push(`${label}: el SKU debe tener entre 3 y 80 caracteres`);
    if (skus.has(sku)) errors.push(`${label}: el SKU ${sku} está repetido`);
    skus.add(sku);
    if (!textInRange(variant.flavor, 1, 80) || !inRange(variant.size.value, Number.MIN_VALUE) || !textInRange(variant.size.unit, 1, 12)) errors.push(`${label}: revisa la opción, el tamaño y su unidad`);
    if (!inRange(variant.price, 0.01, 1000000)) errors.push(`${label}: el precio debe estar entre 0,01 y 1 000 000`);
    if (variant.compareAtPrice != null && !inRange(variant.compareAtPrice, 0, 1000000)) errors.push(`${label}: el precio anterior debe estar entre 0 y 1 000 000`);
    if (!integerInRange(variant.stock, 0, 1000000)) errors.push(`${label}: el stock debe ser un entero entre 0 y 1 000 000`);
    if (variant.reorderPoint !== undefined && !integerInRange(variant.reorderPoint, 0, 100000)) errors.push(`${label}: el stock mínimo debe ser un entero entre 0 y 100 000`);
    if (variant.images.length > 8) errors.push(`${label}: el máximo es 8 fotografías`);
    variant.images.forEach((photo, photoIndex) => {
      if (!textInRange(photo.alt, 1, 140)) errors.push(`${label}, foto ${photoIndex + 1}: agrega una descripción de hasta 140 caracteres`);
      if (photo.url.trim().length > 600 || !/^(https?:\/\/|\/(?!\/))[^\s]+$/i.test(photo.url.trim())) errors.push(`${label}, foto ${photoIndex + 1}: sube la fotografía o elige una de la biblioteca`);
    });
  });
  return errors;
}

export function productFormToPayload(form: FormState, product?: Product | null) {
  return {
    title: form.title,
    brand: form.brand,
    slug: form.slug,
    shortDescription: form.description,
    productType: form.productType,
    nutritionalFacts: form.productType === "SUPPLEMENT" ? { servingSize: form.servingSize, calories: form.calories, protein: form.protein, carbohydrates: form.carbs, fats: form.fats } : null,
    variants: form.variants.map(variant => ({
      flavor: variant.flavor, size: { value: variant.size.value, unit: variant.size.unit },
      price: variant.price, compareAtPrice: variant.compareAtPrice, stock: variant.stock,
      reorderPoint: variant.reorderPoint, sku: variant.sku,
      images: variant.images.map(({ url, alt }) => ({ url, alt }))
    })),
    categories: listFromText(form.categories).map(name => { const current = product?.categories.find(item => item.name === name); return current ? { name: current.name, slug: current.slug } : ref(name); }),
    goals: form.goals.map(name => { const current = product?.goals.find(item => item.name === name); return current ? { name: current.name, slug: current.slug } : ref(name); }),
    vitalCoinsReward: form.coins,
    maxInstallments: form.installments,
    hasFreeShipping: form.freeShipping,
    storeBadges: listFromText(form.storeBadges),
    featured: form.featured
  };
}
