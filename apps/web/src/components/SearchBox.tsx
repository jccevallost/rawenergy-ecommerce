import { type FormEvent, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { gql, useQuery } from "@apollo/client";
import { Search } from "lucide-react";
import { CATALOG_CATEGORIES, type CatalogCategory, type ProductConnection, SEARCH_PRODUCTS } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { AssetImage } from "./AssetImage";
import { PhotoFallback } from "./PhotoFallback";
import { productThumbCandidates } from "../lib/assetCatalog";
import { catalogHref, productHref } from "../lib/catalogUrl";
import { navigate } from "../lib/router";

const BRANDS = gql`query CatalogBrands { catalogBrands }`;
const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

type Suggestion = { id: string; kind: "Tipo" | "Marca" | "Producto"; label: string; detail?: string; href: string; product?: ProductConnection["edges"][number]["node"] };
const plain = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Buscador de la cabecera con sugerencias mientras se escribe (C65, V29): tipos de producto
 * y marcas que coinciden (sin consultas nuevas: ya los usa la tienda) y hasta 5 productos de
 * la búsqueda normal, pedidos 250 ms después de dejar de escribir. Patrón de cuadro
 * combinado accesible: flechas para recorrer, Enter para abrir, Escape para cerrar.
 */
export function SearchBox({ initial }: { initial: string }) {
  const [query, setQuery] = useState(initial);
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setQuery(initial), [initial]);
  useEffect(() => {
    const text = query.trim();
    const timer = window.setTimeout(() => setTerm(text.length >= MIN_CHARS ? text : ""), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const products = useQuery<{ searchProducts: ProductConnection }>(SEARCH_PRODUCTS, { variables: { filters: { search: term }, pagination: { first: 5 } }, skip: !term || !open, fetchPolicy: "cache-first" });
  const types = useQuery<{ catalogCategories: CatalogCategory[] }>(CATALOG_CATEGORIES, { skip: !open });
  const brands = useQuery<{ catalogBrands: string[] }>(BRANDS, { skip: !open });

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!term) return [];
    const needle = plain(term);
    return [
      ...(types.data?.catalogCategories ?? []).filter(category => plain(category.name).includes(needle)).slice(0, 2)
        .map(category => ({ id: `tipo-${category.slug}`, kind: "Tipo" as const, label: category.name, detail: `${category.count} ${category.count === 1 ? "producto" : "productos"}`, href: catalogHref({ categories: [category.slug] }) })),
      ...(brands.data?.catalogBrands ?? []).filter(brand => plain(brand).includes(needle)).slice(0, 2)
        .map(brand => ({ id: `marca-${brand}`, kind: "Marca" as const, label: brand, href: catalogHref({ brands: [brand] }) })),
      // Primero los productos cuyo nombre coincide; después los que coinciden por descripción o sabor.
      ...[...(products.data?.searchProducts.edges ?? [])].sort((a, b) => Number(plain(b.node.title).includes(needle)) - Number(plain(a.node.title).includes(needle))).map(({ node }) => ({ id: `producto-${node.id}`, kind: "Producto" as const, label: node.title, detail: `${node.brand} · ${node.priceRange.min !== node.priceRange.max ? "desde " : ""}${formatMoney(node.priceRange.min)}`, href: productHref(node.slug), product: node }))
    ];
  }, [term, types.data, brands.data, products.data]);
  useEffect(() => setActive(-1), [term]);

  const expanded = open && !!term && (suggestions.length > 0 || !products.loading);
  const go = (href: string) => { setOpen(false); input.current?.blur(); navigate(href); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const choice = suggestions[active];
    if (expanded && choice) return go(choice.href);
    const text = query.trim();
    go(catalogHref(text ? { search: text } : {}));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") { if (open) { event.preventDefault(); setOpen(false); setActive(-1); } return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setOpen(true);
    if (!suggestions.length) return;
    setActive(current => event.key === "ArrowDown" ? (current + 1) % suggestions.length : current <= 0 ? suggestions.length - 1 : current - 1);
  };

  return (
    <div className="search-box">
      <form className="header-search" role="search" onSubmit={submit}>
        <label className="sr-only" htmlFor="buscar">Buscar productos</label>
        <input id="buscar" ref={input} type="search" enterKeyHint="search" autoComplete="off" maxLength={80} placeholder="Busca proteína, creatina o una marca"
          role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId} aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          value={query} onChange={event => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)} onKeyDown={onKeyDown} />
        <button type="submit" className="header-search-submit" aria-label="Buscar"><Search size={20} /></button>
      </form>
      <ul id={listId} role="listbox" aria-label="Sugerencias" className="search-suggestions" hidden={!expanded}>
        {suggestions.map((item, index) => (
          <li key={item.id} id={`${listId}-${index}`} role="option" aria-selected={index === active} className={index === active ? "is-active" : undefined}
            onMouseDown={event => event.preventDefault()} onClick={() => go(item.href)} onMouseEnter={() => setActive(index)}>
            {item.product
              ? <AssetImage candidates={productThumbCandidates(item.product)} alt="" fallback={<PhotoFallback brand={item.product.brand} size={20} />} />
              : <span className="suggestion-kind">{item.kind}</span>}
            <span><b>{item.label}</b>{item.detail && <small>{item.detail}</small>}</span>
          </li>
        ))}
        {!suggestions.length && <li role="option" aria-disabled="true" aria-selected={false} className="search-empty">Sin sugerencias. Pulsa Enter para buscar «{term}».</li>}
      </ul>
      <p className="sr-only" role="status">{expanded ? (suggestions.length ? `${suggestions.length} sugerencias. Usa las flechas para recorrerlas.` : "Sin sugerencias.") : ""}</p>
    </div>
  );
}
