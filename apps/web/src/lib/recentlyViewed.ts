import { type Product, safeImageUrl } from "@vital-forge/shared-logic";
import { productImageCandidates } from "./assetCatalog";
import { goalName } from "./goals";

// Últimos productos vistos en este navegador, para recomendar «porque viste…».
// Solo guarda datos de presentación (sin precio, que podría quedar desactualizado)
// y se valida al leer porque localStorage es editable.
const KEY = "rawenergy-recent-v1";
const MAX = 8;

export type RecentProduct = { id: string; slug: string; title: string; brand: string; image?: string; goal?: string; goalName?: string };

const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;

export function readRecent(): RecentProduct[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, MAX).flatMap(entry => {
      const item = entry as Record<string, unknown>;
      if (!text(item.id, 120) || !text(item.title, 160) || !text(item.brand, 80) || typeof item.slug !== "string" || !/^[a-z0-9-]{1,160}$/.test(item.slug)) return [];
      const goal = typeof item.goal === "string" && /^[a-z0-9-]{1,80}$/.test(item.goal) ? item.goal : undefined;
      return [{ id: item.id as string, slug: item.slug, title: item.title as string, brand: item.brand as string, image: safeImageUrl(item.image), goal, goalName: goal && text(item.goalName, 80) ? item.goalName as string : undefined }];
    });
  } catch { return []; }
}

export function rememberProduct(product: Product) {
  const entry: RecentProduct = {
    id: product.id, slug: product.slug, title: product.title, brand: product.brand,
    image: safeImageUrl(productImageCandidates(product)[0]), goal: product.goals[0]?.slug, goalName: product.goals[0] ? goalName(product.goals[0].slug) : undefined
  };
  try { localStorage.setItem(KEY, JSON.stringify([entry, ...readRecent().filter(item => item.id !== product.id)].slice(0, MAX))); } catch { /* navegación privada o almacenamiento lleno: se omite */ }
}
