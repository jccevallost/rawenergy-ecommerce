import { type HTMLAttributes, type ReactNode, useId, useRef } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Product } from "@vital-forge/shared-logic";
import { ProductCard } from "./ProductCard";
import { ProductSkeleton } from "./ProductSkeleton";
import { Link } from "../lib/router";

type RailProps = {
  title: string;
  subtitle?: ReactNode;
  products: Product[];
  loading?: boolean;
  error?: ReactNode;
  viewAll?: { to: string; label: string };
  /** Contenido entre el encabezado y el carril, p. ej. pestañas. */
  children?: ReactNode;
  /** Atributos del contenedor del carril (p. ej. role="tabpanel"). */
  panelProps?: HTMLAttributes<HTMLDivElement>;
  id?: string;
};

/** Carril horizontal de productos con flechas, desplazamiento táctil y enlace «Ver todo». */
export function ProductRail({ title, subtitle, products, loading, error, viewAll, children, panelProps, id }: RailProps) {
  const headingId = useId();
  const track = useRef<HTMLUListElement>(null);
  const scroll = (direction: 1 | -1) => {
    const element = track.current;
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({ left: direction * element.clientWidth * 0.85, behavior: reduced ? "auto" : "smooth" });
  };
  return (
    <section className="rail container" aria-labelledby={headingId} id={id}>
      <header className="rail-head">
        <div>
          <h2 id={headingId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="rail-actions">
          {viewAll && <Link to={viewAll.to} className="btn btn-link">{viewAll.label} <ArrowRight size={16} aria-hidden="true" /></Link>}
          <button type="button" className="icon-btn" onClick={() => scroll(-1)} aria-label={`Anteriores en ${title}`}><ArrowLeft size={18} /></button>
          <button type="button" className="icon-btn" onClick={() => scroll(1)} aria-label={`Siguientes en ${title}`}><ArrowRight size={18} /></button>
        </div>
      </header>
      {children}
      <div {...panelProps}>
        {error ? <div className="notice notice-error" role="alert">{error}</div> : (
          <ul className="rail-track" ref={track} aria-busy={loading}>
            {loading
              ? Array.from({ length: 4 }, (_, index) => <li key={index}><ProductSkeleton /></li>)
              : products.map(product => <li key={product.id}><ProductCard product={product} /></li>)}
          </ul>
        )}
      </div>
    </section>
  );
}
