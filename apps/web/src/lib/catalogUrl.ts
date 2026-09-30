import type { ProductFilters } from "@vital-forge/shared-logic";

// Los filtros del catálogo viven en la URL: se pueden compartir, sobreviven a una
// recarga y «Atrás» devuelve la búsqueda anterior. Todo valor se valida al leerlo
// porque la URL la puede escribir cualquiera; el servidor vuelve a validar.
const SORT_PARAMS = { "menor-precio": "PRICE_ASC", "mayor-precio": "PRICE_DESC" } as const;
type SortParam = keyof typeof SORT_PARAMS;

const list = (search: URLSearchParams, key: string, pattern?: RegExp) =>
  [...new Set(search.getAll(key).map(value => value.trim()).filter(value => value && value.length <= 80 && (!pattern || pattern.test(value))))].slice(0, 12);

const price = (search: URLSearchParams, key: string) => {
  const raw = search.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1_000_000 ? value : undefined;
};

export function filtersFromSearch(search: URLSearchParams): ProductFilters {
  const text = (search.get("q") ?? "").trim().slice(0, 80);
  const brands = list(search, "marca");
  const goals = list(search, "uso", /^[a-z0-9-]+$/);
  const sort = SORT_PARAMS[search.get("orden") as SortParam];
  const minPrice = price(search, "min");
  const maxPrice = price(search, "max");
  return {
    ...(text ? { search: text } : {}),
    ...(brands.length ? { brands } : {}),
    ...(goals.length ? { goals } : {}),
    ...(search.get("disponible") === "1" ? { inStock: true } : {}),
    ...(minPrice !== undefined ? { minPrice } : {}),
    ...(maxPrice !== undefined ? { maxPrice } : {}),
    ...(sort ? { sort } : {})
  };
}

export function catalogHref(filters: ProductFilters = {}) {
  const search = new URLSearchParams();
  if (filters.search?.trim()) search.set("q", filters.search.trim());
  filters.brands?.forEach(brand => search.append("marca", brand));
  filters.goals?.forEach(goal => search.append("uso", goal));
  if (filters.inStock) search.set("disponible", "1");
  if (filters.minPrice !== undefined) search.set("min", String(filters.minPrice));
  if (filters.maxPrice !== undefined) search.set("max", String(filters.maxPrice));
  const sort = (Object.keys(SORT_PARAMS) as SortParam[]).find(key => SORT_PARAMS[key] === filters.sort);
  if (sort) search.set("orden", sort);
  const query = search.toString();
  return query ? `/catalogo?${query}` : "/catalogo";
}

export const productHref = (slug: string) => `/producto/${encodeURIComponent(slug)}`;
export const campaignHref = (slug: string) => `/campana/${encodeURIComponent(slug)}`;

export const activeFilterCount = (filters: ProductFilters) =>
  (filters.brands?.length ?? 0) + (filters.goals?.length ?? 0) + Number(!!filters.inStock)
  + Number(filters.minPrice !== undefined || filters.maxPrice !== undefined) + Number(!!filters.search);
