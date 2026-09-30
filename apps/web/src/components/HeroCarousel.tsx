import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Package, Pause, Play } from "lucide-react";
import { type Product } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { AssetImage } from "./AssetImage";
import { PhotoFallback } from "./PhotoFallback";
import { productThumbCandidates } from "../lib/assetCatalog";
import { productHref } from "../lib/catalogUrl";
import { keepPreview } from "../lib/productPreview";
import { Link } from "../lib/router";

export type HeroSlide = {
  key: string;
  eyebrow: string;
  title: string;
  message: string;
  ctaLabel: string;
  href: string;
  theme: "noche" | "oro" | "claro";
  imageUrl?: string | null;
  products: Product[];
};

/** Foto de campaña o collage de hasta tres productos reales con su precio vigente. */
function SlideMedia({ slide }: { slide: HeroSlide }) {
  if (slide.imageUrl) return <div className="promo-media promo-media-banner"><AssetImage candidates={[slide.imageUrl]} alt="" loading="eager" className="promo-banner" fallback={<span className="photo-fallback"><Package size={64} /></span>} /></div>;
  const picks = slide.products.slice(0, 3);
  if (!picks.length) return <div className="promo-media"><span className="photo-fallback"><Package size={72} /></span></div>;
  return (
    <ul className={`promo-media promo-collage count-${picks.length}`}>
      {picks.map((product, index) => (
        <li key={product.id}>
          <Link to={productHref(product.slug)} onClick={() => keepPreview(product)} aria-label={`${product.title}, desde ${formatMoney(product.priceRange.min)}`}>
            <AssetImage candidates={productThumbCandidates(product)} alt="" loading={index === 0 ? "eager" : "lazy"} fallback={<PhotoFallback brand={product.brand} />} />
            <span aria-hidden="true"><b>{product.title}</b><small>{product.priceRange.min !== product.priceRange.max && <span className="collage-from">Desde </span>}{formatMoney(product.priceRange.min)}</small></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(!document.hidden);
  const touchStart = useRef<number | null>(null);
  const rotationIntent = useRef<boolean | null>(null);
  const count = slides.length;
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduce = () => { if (media.matches) setPlaying(false); };
    const visibility = () => setVisible(!document.hidden);
    media.addEventListener("change", reduce);
    document.addEventListener("visibilitychange", visibility);
    return () => { media.removeEventListener("change", reduce); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => { if (index >= count) setIndex(0); }, [count, index]);
  useEffect(() => {
    if (!playing || hovered || !visible || count < 2) return;
    const timer = window.setTimeout(() => setIndex(value => (value + 1) % count), 8000);
    return () => window.clearTimeout(timer);
  }, [index, playing, hovered, visible, count]);

  if (!count) return null;
  const move = (next: number) => { setPlaying(false); setIndex((next + count) % count); };
  const current = slides[Math.min(index, count - 1)]!;
  const next = slides[(index + 1) % count]!;
  const peekPhoto = next.imageUrl ? [next.imageUrl] : productThumbCandidates(next.products[0]);
  return (
    <section className="hero" aria-label="Campañas y destacados de la tienda" aria-roledescription="carrusel"
      onFocusCapture={() => setPlaying(false)} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onTouchStart={event => { touchStart.current = event.touches[0]?.clientX ?? null; setPlaying(false); }}
      onTouchEnd={event => { const end = event.changedTouches[0]?.clientX; if (touchStart.current !== null && end !== undefined && Math.abs(end - touchStart.current) > 50) move(index + (end < touchStart.current ? 1 : -1)); touchStart.current = null; }}>
      <div className="promo-window">
        <article className={`promo-slide theme-${current.theme}`} key={current.key} aria-roledescription="diapositiva" aria-label={`${index + 1} de ${count}`} aria-live={playing ? "off" : "polite"}>
          <div className="promo-copy">
            <span className="eyebrow">{current.eyebrow}</span>
            <h2>{current.title}</h2>
            <p>{current.message}</p>
            <Link to={current.href} className="btn btn-primary btn-lg">{current.ctaLabel} <ArrowRight size={20} aria-hidden="true" /></Link>
          </div>
          <SlideMedia slide={current} />
        </article>
        {count > 1 && (
          <button type="button" className={`promo-peek theme-${next.theme}`} onClick={() => move(index + 1)} aria-label={`Ver siguiente: ${next.title}`}>
            <AssetImage candidates={peekPhoto} alt="" className="promo-photo" fallback={<PhotoFallback brand={next.products[0]?.brand} size={56} />} />
            <span>Siguiente <ArrowRight size={18} aria-hidden="true" /></span>
          </button>
        )}
      </div>
      {count > 1 && (
        <div className="promo-controls">
          <button type="button" className="icon-btn icon-btn-dark" onPointerDown={() => { rotationIntent.current = !playing; }} onClick={() => { const intent = rotationIntent.current; rotationIntent.current = null; setPlaying(value => intent ?? !value); }} aria-label={playing ? "Pausar carrusel" : "Reproducir carrusel"}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
          <button type="button" className="icon-btn icon-btn-dark" onClick={() => move(index - 1)} aria-label="Diapositiva anterior"><ArrowLeft size={18} /></button>
          <div className="promo-dots" role="group" aria-label="Elegir diapositiva">
            {slides.map((slide, number) => <button type="button" key={slide.key} aria-label={`Diapositiva ${number + 1}: ${slide.title}`} aria-current={number === index ? "true" : undefined} onClick={() => move(number)}><span /></button>)}
          </div>
          <button type="button" className="icon-btn icon-btn-dark" onClick={() => move(index + 1)} aria-label="Diapositiva siguiente"><ArrowRight size={18} /></button>
          <small className="promo-status">{playing ? "Cambia cada 8 segundos" : "En pausa"}</small>
        </div>
      )}
    </section>
  );
}

/** Espacio reservado mientras llegan las campañas: evita que la portada salte. */
export const HeroSkeleton = () => (
  <section className="hero" aria-hidden="true">
    <div className="promo-window"><div className="promo-slide promo-slide-skeleton"><span className="skeleton skeleton-line medium" /><span className="skeleton skeleton-line" /><span className="skeleton skeleton-button" /></div></div>
  </section>
);
