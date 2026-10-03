import { useEffect, useRef, useState } from "react";
import { useQuery } from "@apollo/client";
import { MessageCircle, Minus, Plus, ShieldCheck, ShoppingBag, Truck, Wallet } from "lucide-react";
import { CHECKOUT_INFO, type CheckoutInfo, PRODUCT_BY_SLUG, type Product, useCartOrchestrator, useProductsByGoal } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { Gallery } from "../components/Gallery";
import { sizeLabel } from "../lib/presentations";
import { variantLabel } from "../components/ProductCard";
import { ProductRail } from "../components/ProductRail";
import { productImageCandidates } from "../lib/assetCatalog";
import { catalogHref } from "../lib/catalogUrl";
import { friendlyError } from "../lib/errors";
import { goalName } from "../lib/goals";
import { previewFor } from "../lib/productPreview";
import { rememberProduct } from "../lib/recentlyViewed";
import { Link, usePageEntry } from "../lib/router";
import { showToast } from "../lib/toast";
import { useSingleFlight } from "../lib/useSingleFlight";
import { whatsappHref } from "../lib/whatsapp";
import { cashOnDeliveryConditions, freeShippingText } from "../lib/commerceText";

type Variant = Product["variants"][number];
const sizeOf = (variant: Variant) => {
  const value = variant.size?.value ?? variant.sizeValue;
  const unit = variant.size?.unit ?? variant.sizeUnit ?? "";
  return value ? `${value} ${unit}`.trim() : unit || "Única";
};

function OptionGroup({ legend, name, options, value, onChange }: { legend: string; name: string; options: Array<{ value: string; label: string; soldOut: boolean }>; value: string; onChange: (value: string) => void }) {
  return (
    <fieldset className="options">
      <legend>{legend}: <b>{options.find(option => option.value === value)?.label}</b></legend>
      <div className="option-list">
        {options.map(option => (
          <label key={option.value} className={`option ${option.soldOut ? "is-sold-out" : ""}`}>
            <input type="radio" name={name} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} />
            <span>{option.label}{option.soldOut && <small> · agotado</small>}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Descripción y datos estructurados (schema.org Product) de la ficha, con datos
 * vigentes de la API. Buscadores que ejecutan JavaScript los leen; las vistas
 * previas de redes sociales necesitan renderizado en servidor (pendiente).
 */
function useProductMetadata(product: Product) {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previous = meta?.content;
    if (meta) meta.content = (product.shortDescription || `${product.title} de ${product.brand}`).slice(0, 160);
    const prices = product.variants.map(variant => variant.price);
    const images = productImageCandidates(product).map(url => new URL(url, window.location.origin).href);
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify({
      "@context": "https://schema.org", "@type": "Product", name: product.title, brand: { "@type": "Brand", name: product.brand },
      description: product.shortDescription || undefined, image: images.length ? images : undefined, url: window.location.href,
      offers: { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: product.variants.length,
        availability: product.variants.some(variant => variant.stock > 0) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" }
    });
    document.head.appendChild(script);
    return () => { script.remove(); if (meta && previous !== undefined) meta.content = previous; };
  }, [product]);
}

function ProductView({ product }: { product: Product }) {
  const { addItem, toggleCart, itemCount } = useCartOrchestrator();
  const { data: checkout } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const [sku, setSku] = useState(() => (product.variants.find(candidate => candidate.stock > 0) ?? product.variants[0])?.sku ?? "");
  const [quantity, setQuantity] = useState(1);
  const heading = useRef<HTMLHeadingElement>(null);
  // La barra fija del móvil repite «Agregar al carrito»: aparece solo cuando el bloque de compra
  // ya quedó atrás (por encima de la pantalla), para no tapar la foto al entrar ni duplicar el botón (C54).
  // La zona observada se alarga hacia abajo: el aviso llega al cruzar el borde superior, también en saltos
  // (scroll restaurado, enlaces), y no al entrar o salir por abajo.
  const purchaseRef = useRef<HTMLDivElement>(null);
  const [buyBarHidden, setBuyBarHidden] = useState(true);
  useEffect(() => {
    const target = purchaseRef.current;
    if (!target || typeof IntersectionObserver === "undefined") { setBuyBarHidden(false); return; }
    const observer = new IntersectionObserver(([entry]) => setBuyBarHidden(!entry || entry.isIntersecting), { rootMargin: "0px 0px 100000px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  usePageEntry(product.title, heading);
  useEffect(() => { rememberProduct(product); }, [product]);
  useProductMetadata(product);

  const variant = product.variants.find(candidate => candidate.sku === sku) ?? product.variants[0]!;
  const maxQuantity = Math.max(1, Math.min(99, variant.stock));
  useEffect(() => setQuantity(value => Math.min(value, maxQuantity)), [maxQuantity]);
  const flavors = [...new Set(product.variants.map(candidate => candidate.flavor))];
  const sizes = product.variants.filter(candidate => candidate.flavor === variant.flavor);
  const pickFlavor = (flavor: string) => {
    const next = product.variants.find(candidate => candidate.flavor === flavor && candidate.stock > 0) ?? product.variants.find(candidate => candidate.flavor === flavor);
    if (next) setSku(next.sku);
  };

  const photosOf = (candidate: typeof variant) => candidate.images?.map(image => image.url) ?? candidate.imageUrls ?? [];
  const variantPhotos = photosOf(variant);
  // Sin fotos propias (C47): primero las de otro sabor del mismo tamaño (mismo envase) y solo después la foto general.
  const sameSize = product.variants.filter(candidate => candidate.sku !== variant.sku && sizeLabel(candidate) === sizeLabel(variant)).map(photosOf).find(list => list.length) ?? [];
  const urls = [...new Set(variantPhotos.length ? variantPhotos : sameSize.length ? sameSize : productImageCandidates(product))];
  const photos = urls.map((url, index) => ({ url, alt: variant.imageAlts?.[index] || `${product.title}, ${variantLabel(variant)}, foto ${index + 1}` }));
  const soldOut = variant.stock <= 0;
  const compareAt = variant.compareAtPrice && variant.compareAtPrice > variant.price ? variant.compareAtPrice : null;
  const goal = product.goals[0];
  const related = useProductsByGoal(goal?.slug ?? "", 10, { skip: !goal });
  const relatedProducts = related.data.filter(candidate => candidate.id !== product.id);
  const info = checkout?.checkoutInfo;

  const line = () => ({ productId: product.id, variantSku: variant.sku, title: product.title, variantLabel: variantLabel(variant), image: photos[0]?.url, unitPrice: variant.price, quantity, vitalCoinsReward: product.vitalCoinsReward, maxQuantity: variant.stock });
  const [add, adding] = useSingleFlight(() => {
    if (soldOut) return;
    addItem(line(), { open: false });
    setAdded(true);
    showToast(`Agregaste ${quantity} × ${product.title} al carrito.`, { label: "Ver carrito", run: () => toggleCart(true) });
  }, 1500);
  // Tras agregar, «Ver carrito» queda junto al botón (auditoría C41): con teclado es el siguiente Tab.
  const [added, setAdded] = useState(false);
  const [buyNow] = useSingleFlight(() => {
    if (soldOut) return;
    addItem(line(), { open: false });
    toggleCart(true, "checkout");
  }, 1500);

  return (
    <div className="product-page">
      <div className="container">
        <nav className="breadcrumb" aria-label="Ruta de navegación">
          <ol>
            <li><Link to="/">Inicio</Link></li>
            <li><Link to={catalogHref()}>Catálogo</Link></li>
            {goal && <li><Link to={catalogHref({ goals: [goal.slug] })}>{goalName(goal.slug)}</Link></li>}
            <li aria-current="page">{product.title}</li>
          </ol>
        </nav>
        <div className="product-layout">
          <Gallery key={variant.sku} photos={photos} brand={product.brand} />
          <div className="buy-box">
            <Link to={catalogHref({ brands: [product.brand] })} className="product-brand">{product.brand}</Link>
            <h1 ref={heading} tabIndex={-1}>{product.title}</h1>
            <div className="product-price" aria-live="polite">
              <strong>{formatMoney(variant.price)}</strong>
              {compareAt && <><s><span className="sr-only">Precio anterior </span>{formatMoney(compareAt)}</s><span className="badge badge-success">Ahorras {formatMoney(compareAt - variant.price)}</span></>}
            </div>
            <p className={`stock-line ${soldOut ? "is-out" : variant.stock <= 5 ? "is-low" : "is-ok"}`}>
              {soldOut ? "Esta presentación está agotada. Elige otra opción." : variant.stock <= 5 ? `Disponible · quedan ${variant.stock} ${variant.stock === 1 ? "unidad" : "unidades"}` : "Disponible"}
            </p>
            {product.shortDescription && <p className="product-summary">{product.shortDescription}</p>}

            {flavors.length > 1 && <OptionGroup legend="Sabor" name="sabor" value={variant.flavor} onChange={pickFlavor}
              options={flavors.map(flavor => ({ value: flavor, label: flavor, soldOut: !product.variants.some(candidate => candidate.flavor === flavor && candidate.stock > 0) }))} />}
            {sizes.length > 1 && <OptionGroup legend="Tamaño" name="tamano" value={variant.sku} onChange={setSku}
              options={sizes.map(candidate => ({ value: candidate.sku, label: sizeOf(candidate), soldOut: candidate.stock <= 0 }))} />}
            {flavors.length <= 1 && sizes.length <= 1 && <p className="selected-variant">Presentación: <b>{variantLabel(variant)}</b></p>}

            <div className="purchase" ref={purchaseRef}>
              <div className="stepper" role="group" aria-label="Cantidad">
                <button type="button" onClick={() => setQuantity(value => Math.max(1, value - 1))} disabled={soldOut || quantity <= 1} aria-label="Quitar una unidad"><Minus size={18} /></button>
                <output aria-live="polite" aria-label={`Cantidad: ${quantity}`}>{quantity}</output>
                <button type="button" onClick={() => setQuantity(value => Math.min(maxQuantity, value + 1))} disabled={soldOut || quantity >= maxQuantity} aria-label="Agregar una unidad"><Plus size={18} /></button>
              </div>
              <button type="button" className={`btn btn-primary btn-lg add-to-cart ${adding ? "is-done" : ""}`} disabled={soldOut} aria-disabled={adding} onClick={() => void add()}>
                {soldOut ? "Agotado" : adding ? "Agregado ✓" : "Agregar al carrito"}
              </button>
              <button type="button" className="btn btn-dark btn-lg buy-now" disabled={soldOut} onClick={() => void buyNow()}>Comprar ahora</button>
              {added && itemCount > 0 && <button type="button" className="btn btn-outline btn-lg view-cart" onClick={() => toggleCart(true)}><ShoppingBag size={18} aria-hidden="true" />Ver carrito ({itemCount})</button>}
            </div>

            <ul className="assurances">
              <li><Truck size={20} aria-hidden="true" /><span>Express en 4 horas en Quito y Valles; Servientrega en 24 a 48 horas al resto del país. {info && freeShippingText(info) ? <b>{freeShippingText(info)}.</b> : "Verás el costo antes de confirmar."}</span></li>
              <li><Wallet size={20} aria-hidden="true" /><span>{info?.cashOnDelivery.enabled ? <>Transferencia bancaria o contra entrega ({cashOnDeliveryConditions(info)}); cierras tu compra por WhatsApp.</> : "Pago por transferencia bancaria; cierras tu compra por WhatsApp."} No aceptamos cambios ni devoluciones por preferencia.</span></li>
              <li><ShieldCheck size={20} aria-hidden="true" /><span>Compra sin crear una cuenta.</span></li>
            </ul>
            {info?.whatsapp && <a className="btn btn-link whatsapp-ask" href={whatsappHref(info.whatsapp, `Hola RawEnergy, tengo una consulta sobre ${product.title} (${variantLabel(variant)}).`)} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} aria-hidden="true" /> ¿Dudas sobre este producto? Pregúntanos por WhatsApp</a>}
          </div>
        </div>

        <div className="product-details">
          {product.nutritionalFacts && (() => {
            const facts = product.nutritionalFacts;
            const rows = [["Energía", facts.calories, "kcal"], ["Proteína", facts.protein, "g"], ["Carbohidratos", facts.carbohydrates, "g"], ["Grasas", facts.fats, "g"]] as const;
            const declared = rows.some(([, value]) => value !== null);
            return (
              <section aria-labelledby="nutricion">
                <h2 id="nutricion">Información nutricional</h2>
                {declared ? (
                  <table className="nutrition">
                    <caption>Por porción: {facts.servingSize}</caption>
                    <tbody>
                      {rows.map(([label, value, unit]) => (
                        <tr key={label}><th scope="row">{label}</th><td>{value === null ? <span className="undeclared">No declarado</span> : `${value.toLocaleString("es-EC")} ${unit}`}</td></tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="nutrition-note">Porción: <b>{facts.servingSize}</b>. La etiqueta no declara energía ni macronutrientes para este producto; revisa sus ingredientes activos en la descripción.</p>
                )}
                <p className="nutrition-source">Datos según la etiqueta del fabricante. Revisa siempre la etiqueta del envase que recibes.</p>
              </section>
            );
          })()}
          <section aria-labelledby="presentacion">
            <h2 id="presentacion">Presentación</h2>
            <dl className="facts">
              <div><dt>Marca</dt><dd>{product.brand}</dd></div>
              <div><dt>Seleccionada</dt><dd>{variantLabel(variant)}</dd></div>
              {!!product.categories.length && <div><dt>Categoría</dt><dd>{product.categories.map(category => category.name).join(", ")}</dd></div>}
              {!!product.goals.length && <div><dt>Objetivo</dt><dd>{product.goals.map(item => goalName(item.slug)).join(", ")}</dd></div>}
            </dl>
          </section>
        </div>
      </div>

      {goal && (relatedProducts.length > 0 || related.loading) && (
        <ProductRail title={`Más en ${goalName(goal.slug)}`} products={relatedProducts} loading={related.loading} viewAll={{ to: catalogHref({ goals: [goal.slug] }), label: "Ver todo" }} />
      )}

      <div className={`mobile-buy-bar ${buyBarHidden ? "is-hidden" : ""}`} inert={buyBarHidden} aria-hidden={buyBarHidden || undefined}>
        <span><small>{[sizeLabel(variant), variant.flavor].filter(Boolean).join(" · ")}</small><strong>{formatMoney(variant.price)}</strong></span>
        <button type="button" className="btn btn-primary" disabled={soldOut} aria-disabled={adding} onClick={() => void add()}>{soldOut ? "Agotado" : adding ? "Agregado ✓" : "Agregar al carrito"}</button>
      </div>
    </div>
  );
}

export function ProductPage({ slug }: { slug: string }) {
  const preview = previewFor(slug);
  const { data, loading, error, refetch } = useQuery<{ productBySlug: Product | null }>(PRODUCT_BY_SLUG, { variables: { slug } });
  const missing = !!data && !data.productBySlug;
  const product = data?.productBySlug ?? (data ? null : preview ?? null);
  if (product) return <ProductView key={product.id} product={product} />;
  return <ProductStatus missing={missing} error={loading ? undefined : error} onRetry={() => void refetch()} />;
}

function ProductStatus({ missing, error, onRetry }: { missing: boolean; error?: unknown; onRetry: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  usePageEntry(missing ? "Producto no disponible" : error ? "Producto sin conexión" : "Cargando producto", heading);
  return (
    <div className={`container status-page ${!missing && !error ? "loading-page" : ""}`}>
      {missing ? (
        <>
          <h1 ref={heading} tabIndex={-1}>Este producto no está disponible</h1>
          <p>Puede que se haya retirado del catálogo o que el enlace esté incompleto.</p>
          <Link to={catalogHref()} className="btn btn-primary">Ver el catálogo</Link>
        </>
      ) : error ? (
        <>
          <h1 ref={heading} tabIndex={-1}>No pudimos abrir el producto</h1>
          <p>{friendlyError(error, "Vuelve a intentarlo en unos segundos.")}</p>
          <button type="button" className="btn btn-primary" onClick={onRetry}>Reintentar</button>
        </>
      ) : (
        <h1 ref={heading} tabIndex={-1} className="loading-line">Cargando producto…</h1>
      )}
    </div>
  );
}
