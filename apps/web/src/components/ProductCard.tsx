import { useRef } from "react";
import { Check, Plus } from "lucide-react";
import { type Product, useCartOrchestrator } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { AssetImage } from "./AssetImage";
import { PhotoFallback } from "./PhotoFallback";
import { productThumbCandidates } from "../lib/assetCatalog";
import { productHref } from "../lib/catalogUrl";
import { LOW_STOCK, presentationLabel, presentationSummary } from "../lib/presentations";
import { flyPhoto, keepPreview } from "../lib/productPreview";
import { Link } from "../lib/router";
import { showToast } from "../lib/toast";
import { useSingleFlight } from "../lib/useSingleFlight";

export const variantLabel = presentationLabel;

// Ancho de la foto de una tarjeta: 2 columnas en el móvil, 3–4 en tableta y hasta ~240 px en escritorio.
const CARD_SIZES = "(min-width: 1101px) 240px, (min-width: 561px) 31vw, 46vw";

export function ProductCard({ product, priority = false }: { product: Product; priority?: boolean }) {
  const { addItem, toggleCart } = useCartOrchestrator();
  const card = useRef<HTMLElement>(null);
  const variant = product.variants.find(candidate => candidate.stock > 0) ?? product.variants[0];
  const totalStock = product.variants.reduce((sum, candidate) => sum + candidate.stock, 0);
  const href = productHref(product.slug);
  const candidates = productThumbCandidates(product);
  const hasOptions = product.variants.length > 1;
  const summary = presentationSummary(product);

  const [add, adding] = useSingleFlight(() => {
    if (!variant || variant.stock <= 0) return;
    addItem({
      productId: product.id, variantSku: variant.sku, title: product.title, variantLabel: variantLabel(variant),
      image: candidates[0], unitPrice: variant.price, quantity: 1, maxQuantity: variant.stock
    }, { open: false });
    showToast(`Agregaste ${product.title} al carrito.`, { label: "Ver carrito", run: () => toggleCart(true) });
  }, 1500);

  if (!variant) return null;
  const compareAt = !hasOptions && variant.compareAtPrice && variant.compareAtPrice > variant.price ? variant.compareAtPrice : null;
  const open = () => { keepPreview(product); flyPhoto(card.current); };

  return (
    <article className="card" ref={card}>
      <Link to={href} className="card-media" tabIndex={-1} aria-hidden="true" onClick={open}>
        <AssetImage candidates={candidates} alt="" loading={priority ? "eager" : "lazy"} sizes={CARD_SIZES} fallback={<PhotoFallback brand={product.brand} />} />
        {totalStock <= 0 ? <span className="badge badge-muted">Agotado</span>
          : !hasOptions && variant.stock <= LOW_STOCK ? <span className="badge badge-warning">Quedan {variant.stock}</span>
          : product.featured ? <span className="badge">Destacado</span> : null}
      </Link>
      <div className="card-body">
        <span className="card-brand">{product.brand}</span>
        <h3 className="card-title"><Link to={href} onClick={open}>{product.title}</Link></h3>
        <p className="card-price">
          {hasOptions && product.priceRange.min !== product.priceRange.max && <small>Desde </small>}
          <strong>{formatMoney(hasOptions ? product.priceRange.min : variant.price)}</strong>
          {compareAt && <s aria-label={`Antes ${formatMoney(compareAt)}`}>{formatMoney(compareAt)}</s>}
        </p>
        {hasOptions && summary.text && <p className="card-options">{summary.text}</p>}
        <p className={`card-stock ${totalStock > 0 ? "is-available" : ""}`}>{totalStock > 0 ? (hasOptions ? "Disponible" : ["Disponible", summary.sizes[0]].filter(Boolean).join(" · ")) : "Sin existencias por ahora"}</p>
        {totalStock <= 0
          ? <button type="button" className="btn btn-outline btn-block" disabled>Agotado</button>
          : hasOptions
            ? <Link to={href} className="btn btn-outline btn-block" onClick={open} aria-label={`Ver opciones de ${product.title}`}>Ver opciones</Link>
            : <button type="button" className={`btn btn-primary btn-block ${adding ? "is-done" : ""}`} onClick={() => void add()} aria-disabled={adding} aria-label={adding ? `${product.title} agregado al carrito` : `Agregar ${product.title} al carrito`}>
                {adding ? <><Check size={18} aria-hidden="true" /> Agregado</> : <><Plus size={18} aria-hidden="true" /> Agregar</>}
              </button>}
      </div>
    </article>
  );
}
