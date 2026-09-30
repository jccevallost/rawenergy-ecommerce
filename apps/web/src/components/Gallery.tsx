import { type KeyboardEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Minus, Package, Plus, X, ZoomIn } from "lucide-react";
import { AssetImage } from "./AssetImage";
import { thumbnail } from "../lib/assetCatalog";
import { PhotoFallback } from "./PhotoFallback";
import { useModalA11y } from "../lib/useModalA11y";

type Photo = { url: string; alt: string };

function Lightbox({ photos, index, onIndex, onClose }: { photos: Photo[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const { dialogRef, headingRef } = useModalA11y<HTMLDivElement, HTMLHeadingElement>(onClose);
  const [zoom, setZoom] = useState(1);
  const photo = photos[index]!;
  const go = (next: number) => { onIndex((next + photos.length) % photos.length); setZoom(1); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight" && photos.length > 1) go(index + 1);
    else if (event.key === "ArrowLeft" && photos.length > 1) go(index - 1);
    else if (event.key === "+" || event.key === "=") setZoom(value => Math.min(3, value + 0.5));
    else if (event.key === "-") setZoom(value => Math.max(1, value - 0.5));
    else return;
    event.preventDefault();
  };
  return createPortal(
    <div className="lightbox" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="lightbox-title" onKeyDown={onKeyDown}>
      <header className="lightbox-bar">
        <h2 id="lightbox-title" ref={headingRef} tabIndex={-1}>Foto {index + 1} de {photos.length}</h2>
        <div className="lightbox-tools">
          <button type="button" className="icon-btn icon-btn-dark" onClick={() => setZoom(value => Math.max(1, value - 0.5))} disabled={zoom <= 1} aria-label="Reducir"><Minus size={20} /></button>
          <span aria-live="polite">{Math.round(zoom * 100)} %</span>
          <button type="button" className="icon-btn icon-btn-dark" onClick={() => setZoom(value => Math.min(3, value + 0.5))} disabled={zoom >= 3} aria-label="Ampliar"><Plus size={20} /></button>
          <button type="button" className="icon-btn icon-btn-dark" onClick={onClose} aria-label="Cerrar fotos"><X size={22} /></button>
        </div>
      </header>
      <div className="lightbox-stage" onDoubleClick={() => setZoom(value => value > 1 ? 1 : 2)}>
        <AssetImage key={photo.url} candidates={[photo.url]} alt={photo.alt} loading="eager" className="lightbox-photo"
          style={{ width: `${zoom * 100}%`, maxWidth: zoom > 1 ? "none" : undefined }} fallback={<span className="photo-fallback"><Package size={64} /></span>} />
      </div>
      {photos.length > 1 && <>
        <button type="button" className="icon-btn icon-btn-dark lightbox-nav prev" onClick={() => go(index - 1)} aria-label="Foto anterior"><ChevronLeft size={26} /></button>
        <button type="button" className="icon-btn icon-btn-dark lightbox-nav next" onClick={() => go(index + 1)} aria-label="Foto siguiente"><ChevronRight size={26} /></button>
      </>}
    </div>,
    document.body
  );
}

/** Galería de la ficha: foto principal, miniaturas, flechas, teclado, gesto y ampliación. */
export function Gallery({ photos, brand }: { photos: Photo[]; brand: string }) {
  const [index, setIndex] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const touchStart = useRef<number | null>(null);
  const current = Math.min(index, Math.max(0, photos.length - 1));
  const photo = photos[current];
  const many = photos.length > 1;
  const go = (next: number) => setIndex((next + photos.length) % photos.length);
  const onKeyDown = (event: KeyboardEvent) => {
    if (!many || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
    event.preventDefault();
    go(current + (event.key === "ArrowRight" ? 1 : -1));
  };
  return (
    <div className="gallery" onKeyDown={onKeyDown}>
      <div className="gallery-stage"
        onTouchStart={event => { touchStart.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={event => { const end = event.changedTouches[0]?.clientX; if (many && touchStart.current !== null && end !== undefined && Math.abs(end - touchStart.current) > 50) go(current + (end < touchStart.current ? 1 : -1)); touchStart.current = null; }}>
        <button type="button" className="gallery-main" disabled={!photo} onClick={() => setZoomOpen(true)} aria-label={photo ? `Ampliar foto ${current + 1} de ${photos.length}` : "Fotografía no disponible"}>
          <AssetImage key={photo?.url ?? "none"} candidates={[photo?.url]} alt={photo?.alt ?? ""} loading="eager" className="gallery-photo"
            fallback={<PhotoFallback brand={brand} size={64} />} />
          {photo && <span className="gallery-hint" aria-hidden="true"><ZoomIn size={16} /> Ampliar</span>}
        </button>
        {many && <>
          <button type="button" className="icon-btn gallery-nav prev" onClick={() => go(current - 1)} aria-label="Foto anterior"><ChevronLeft size={22} /></button>
          <button type="button" className="icon-btn gallery-nav next" onClick={() => go(current + 1)} aria-label="Foto siguiente"><ChevronRight size={22} /></button>
          <span className="gallery-count" aria-live="polite">Foto {current + 1} de {photos.length}</span>
        </>}
      </div>
      {many && (
        <ul className="gallery-thumbs" aria-label="Fotos del producto">
          {photos.map((item, number) => (
            <li key={item.url}>
              <button type="button" aria-label={`Ver foto ${number + 1}`} aria-current={number === current ? "true" : undefined} onClick={() => setIndex(number)}>
                <AssetImage candidates={[thumbnail(item.url), item.url]} alt="" fallback={<Package size={20} />} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {zoomOpen && photo && <Lightbox photos={photos} index={current} onIndex={setIndex} onClose={() => setZoomOpen(false)} />}
    </div>
  );
}
