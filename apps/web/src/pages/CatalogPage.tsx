import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { type ProductFilters, useProductSearch } from "@vital-forge/shared-logic";
import { Filters } from "../components/Filters";
import { ProductCard } from "../components/ProductCard";
import { ProductSkeleton } from "../components/ProductSkeleton";
import { activeFilterCount, catalogHref, filtersFromSearch } from "../lib/catalogUrl";
import { friendlyError } from "../lib/errors";
import { goalName, goals } from "../lib/goals";
import { Link, navigate, usePageEntry } from "../lib/router";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useModalA11y } from "../lib/useModalA11y";
import { useSingleFlight } from "../lib/useSingleFlight";

const PAGE_SIZE = 24;
// Cambios rápidos de casillas se agrupan en una sola consulta.
const FILTER_DELAY_MS = 400;

const titleFor = (filters: ProductFilters) => {
  if (filters.search) return `Resultados para «${filters.search}»`;
  const onlyGoal = filters.goals?.length === 1 && !filters.brands?.length ? filters.goals[0] : undefined;
  if (onlyGoal) return goalName(onlyGoal);
  const onlyBrand = filters.brands?.length === 1 && !filters.goals?.length ? filters.brands[0] : undefined;
  return onlyBrand ?? "Catálogo";
};

export function CatalogPage({ search }: { search: URLSearchParams }) {
  const query = search.toString();
  const applied = useMemo(() => filtersFromSearch(new URLSearchParams(query)), [query]);
  const [draft, setDraft] = useState(applied);
  const timer = useRef<number | undefined>(undefined);
  // La URL cambió (Atrás, enlace, chip): manda sobre cualquier ajuste pendiente.
  useEffect(() => { window.clearTimeout(timer.current); setDraft(applied); }, [applied]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const update = useCallback((next: ProductFilters, immediate = false) => {
    setDraft(next);
    window.clearTimeout(timer.current);
    const commit = () => navigate(catalogHref(next), { replace: true, keepScroll: true });
    if (immediate) commit(); else timer.current = window.setTimeout(commit, FILTER_DELAY_MS);
  }, []);

  const { products, totalCount, loading, loadingMore, error, refetch, hasNextPage, loadMore } = useProductSearch(applied, PAGE_SIZE);
  const [more] = useSingleFlight(useCallback(() => loadMore(), [loadMore]));
  const [retry, retrying] = useSingleFlight(useCallback(() => refetch(), [refetch]));
  const title = titleFor(applied);
  const heading = useRef<HTMLHeadingElement>(null);
  usePageEntry(title, heading);

  const mobile = useMediaQuery("(max-width: 900px)");
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetActive = mobile && sheetOpen;
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const { dialogRef, headingRef } = useModalA11y<HTMLElement, HTMLHeadingElement>(closeSheet, sheetActive, { inertBackground: false });
  const sheetButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!mobile) setSheetOpen(false); }, [mobile]);
  useEffect(() => {
    if (!sheetActive) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; sheetButton.current?.focus(); };
  }, [sheetActive]);

  const count = activeFilterCount(draft);
  const pending = catalogHref(draft) !== catalogHref(applied);
  const initialLoading = loading && !loadingMore && !products.length;
  const chips = [
    ...(draft.search ? [{ label: `«${draft.search}»`, remove: { ...draft, search: undefined } }] : []),
    ...(draft.goals ?? []).map(goal => ({ label: goalName(goal), remove: { ...draft, goals: draft.goals!.filter(item => item !== goal) } })),
    ...(draft.brands ?? []).map(brand => ({ label: brand, remove: { ...draft, brands: draft.brands!.filter(item => item !== brand) } })),
    ...(draft.inStock ? [{ label: "Con existencias", remove: { ...draft, inStock: undefined } }] : []),
    ...(draft.minPrice !== undefined || draft.maxPrice !== undefined ? [{ label: `$${draft.minPrice ?? 0} – ${draft.maxPrice === undefined ? "sin límite" : `$${draft.maxPrice}`}`, remove: { ...draft, minPrice: undefined, maxPrice: undefined } }] : [])
  ];

  return (
    <div className="container catalog-page">
      <nav className="breadcrumb" aria-label="Ruta de navegación">
        <ol><li><Link to="/">Inicio</Link></li><li aria-current="page">{applied.search ? "Búsqueda" : "Catálogo"}</li></ol>
      </nav>
      <header className="catalog-head">
        <h1 ref={heading} tabIndex={-1}>{title}</h1>
        <p className="catalog-count" aria-live="polite">{error ? "" : initialLoading ? "Buscando productos…" : `${totalCount} ${totalCount === 1 ? "producto" : "productos"}`}</p>
      </header>

      <div className="catalog-toolbar">
        <button ref={sheetButton} type="button" className="btn btn-outline filters-open" aria-expanded={sheetActive} aria-controls="filtros" onClick={() => setSheetOpen(true)}>
          <SlidersHorizontal size={18} aria-hidden="true" /> Filtros{count ? ` (${count})` : ""}
        </button>
        <label className="sort">
          <span>Ordenar por</span>
          <select value={draft.sort ?? ""} onChange={event => update({ ...draft, sort: (event.target.value || undefined) as ProductFilters["sort"] }, true)}>
            <option value="">Relevancia</option>
            <option value="PRICE_ASC">Menor precio</option>
            <option value="PRICE_DESC">Mayor precio</option>
          </select>
        </label>
      </div>

      {!!chips.length && (
        <div className="chips" role="group" aria-label="Filtros aplicados">
          {chips.map(chip => <button key={chip.label} type="button" className="chip" onClick={() => update(chip.remove, true)} aria-label={`Quitar filtro ${chip.label}`}>{chip.label} <X size={14} aria-hidden="true" /></button>)}
          <button type="button" className="btn btn-link" onClick={() => update({ sort: draft.sort }, true)}>Limpiar filtros</button>
        </div>
      )}

      <div className="catalog-layout">
        <aside id="filtros" ref={dialogRef} className={`filters ${sheetActive ? "is-open" : ""}`} aria-label="Filtros de productos"
          {...(sheetActive ? { role: "dialog", "aria-modal": true, "aria-labelledby": "filtros-titulo" } : {})}>
          <header className="filters-head">
            <h2 id="filtros-titulo" ref={headingRef} tabIndex={-1}>Filtros</h2>
            <button type="button" className="icon-btn filters-close" onClick={closeSheet} aria-label="Cerrar filtros"><X size={20} /></button>
          </header>
          <Filters filters={draft} onChange={update} />
          <footer className="filters-foot">
            <button type="button" className="btn btn-primary btn-block btn-lg" onClick={closeSheet}>{pending || loading ? "Actualizando…" : `Ver ${totalCount} ${totalCount === 1 ? "producto" : "productos"}`}</button>
          </footer>
        </aside>

        <section className="results" aria-label="Resultados" aria-busy={loading || pending}>
          {error ? (
            <div className="notice notice-error" role="alert">
              <span>{friendlyError(error, "No pudimos cargar el catálogo.")}</span>
              <button type="button" className="btn btn-outline btn-sm" disabled={retrying} onClick={() => void retry()}>{retrying ? "Reintentando…" : "Reintentar"}</button>
            </div>
          ) : !initialLoading && !products.length ? (
            <div className="empty-state">
              <h2>No encontramos productos con estos filtros</h2>
              <p>Prueba con otra palabra, quita algún filtro o explora por objetivo.</p>
              <div className="empty-actions">
                {!!count && <button type="button" className="btn btn-primary" onClick={() => update({}, true)}>Ver todo el catálogo</button>}
                {goals.map(goal => <Link key={goal.slug} className="chip" to={catalogHref({ goals: [goal.slug] })}>{goal.label}</Link>)}
              </div>
            </div>
          ) : (
            <ul className={`product-grid ${pending || (loading && !loadingMore) ? "is-updating" : ""}`}>
              {initialLoading
                ? Array.from({ length: 8 }, (_, index) => <li key={index}><ProductSkeleton /></li>)
                : products.map((product, index) => <li key={product.id}><ProductCard product={product} priority={index < 4} /></li>)}
            </ul>
          )}
          {!initialLoading && !!products.length && (
            <div className="load-more">
              <p>Mostrando {products.length} de {totalCount}</p>
              {hasNextPage && <button type="button" className="btn btn-outline" disabled={loadingMore} onClick={() => void more()}>{loadingMore ? "Cargando…" : "Cargar más productos"}</button>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
