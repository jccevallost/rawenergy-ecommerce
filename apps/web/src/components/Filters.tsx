import { type FormEvent, useEffect, useState } from "react";
import { gql, useQuery } from "@apollo/client";
import type { ProductFilters } from "@vital-forge/shared-logic";
import { goals } from "../lib/goals";

const BRANDS = gql`query CatalogBrands { catalogBrands }`;

type FiltersProps = { filters: ProductFilters; onChange: (next: ProductFilters, immediate?: boolean) => void };

export function Filters({ filters, onChange }: FiltersProps) {
  const { data, error, refetch } = useQuery<{ catalogBrands: string[] }>(BRANDS);
  const [prices, setPrices] = useState({ min: "", max: "" });
  const [priceError, setPriceError] = useState("");
  useEffect(() => { setPrices({ min: filters.minPrice?.toString() ?? "", max: filters.maxPrice?.toString() ?? "" }); setPriceError(""); }, [filters.minPrice, filters.maxPrice]);

  const toggle = (key: "brands" | "goals", value: string) => {
    const current = filters[key] ?? [];
    const next = current.includes(value) ? current.filter(item => item !== value) : [...current, value];
    onChange({ ...filters, [key]: next.length ? next : undefined });
  };
  const applyPrice = (event: FormEvent) => {
    event.preventDefault();
    const minPrice = prices.min === "" ? undefined : Number(prices.min);
    const maxPrice = prices.max === "" ? undefined : Number(prices.max);
    if ([minPrice, maxPrice].some(value => value !== undefined && (!Number.isFinite(value) || value < 0))) { setPriceError("Escribe importes positivos."); return; }
    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) { setPriceError("El mínimo debe ser menor o igual al máximo."); return; }
    setPriceError("");
    onChange({ ...filters, minPrice, maxPrice }, true);
  };

  return (
    <div className="filter-groups">
      <fieldset className="filter-group">
        <legend>Disponibilidad</legend>
        <label className="check"><input type="checkbox" checked={!!filters.inStock} onChange={event => onChange({ ...filters, inStock: event.target.checked || undefined })} /><span>Solo con existencias</span></label>
      </fieldset>
      <fieldset className="filter-group">
        <legend>Objetivo</legend>
        {goals.map(goal => <label className="check" key={goal.slug}><input type="checkbox" checked={filters.goals?.includes(goal.slug) ?? false} onChange={() => toggle("goals", goal.slug)} /><span>{goal.label}</span></label>)}
      </fieldset>
      <fieldset className="filter-group">
        <legend>Marca</legend>
        {error && <button type="button" className="btn btn-link" onClick={() => void refetch()}>No se cargaron las marcas. Reintentar</button>}
        {data?.catalogBrands.map(brand => <label className="check" key={brand}><input type="checkbox" checked={filters.brands?.includes(brand) ?? false} onChange={() => toggle("brands", brand)} /><span>{brand}</span></label>)}
      </fieldset>
      <form className="filter-group price-filter" onSubmit={applyPrice} aria-describedby={priceError ? "price-error" : "price-help"}>
        <fieldset>
          <legend>Precio (USD)</legend>
          <p id="price-help" className="field-help">Según el precio inicial de cada producto.</p>
          <div className="price-inputs">
            <label className="field"><span>Mínimo</span><input type="number" name="min" min="0" max="1000000" step="0.01" inputMode="decimal" value={prices.min} onChange={event => setPrices({ ...prices, min: event.target.value })} /></label>
            <label className="field"><span>Máximo</span><input type="number" name="max" min="0" max="1000000" step="0.01" inputMode="decimal" value={prices.max} onChange={event => setPrices({ ...prices, max: event.target.value })} /></label>
          </div>
          {priceError && <p id="price-error" className="field-error" role="alert">{priceError}</p>}
          <button type="submit" className="btn btn-outline btn-block">Aplicar precio</button>
        </fieldset>
      </form>
    </div>
  );
}
