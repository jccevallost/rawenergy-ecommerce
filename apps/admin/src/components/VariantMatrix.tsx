import { ImagePlus, Loader2, PackageOpen } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { VariantDraft } from "@vital-forge/shared-logic";
import { useConfirm } from "./common/ConfirmDialog";
import { useImageQueue } from "./ImageUploadQueue";
import { thumbnailUrl } from "../lib/uploadImage";
import { addToSize, altInSize, coverOfSize, MAX_PHOTOS, photoAlt, removeFromSize, sizeAlt, sizeGroups, sizeKey, type SizeGroup } from "../lib/sizePhotos";
const Library = lazy(() => import("./SystemPanels").then((m) => ({ default: m.MediaPanel })));
const SIZE = "size:";
const ACCEPT = "image/png,image/jpeg,image/webp,image/avif,image/gif,image/tiff";

export function VariantMatrix({ variants, onChange, title = "", onBusyChange, onRemove, stockReadonly = false, disabled = false }: { variants: VariantDraft[]; onChange: (variants: VariantDraft[]) => void; title?: string; onBusyChange?: (busy: boolean) => void; onRemove?: (index: number) => void; stockReadonly?: boolean; disabled?: boolean }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const locked = disabled || busy || libraryBusy;
  useEffect(() => { onBusyChange?.(busy || libraryBusy); }, [busy, libraryBusy, onBusyChange]);
  const [error, setError] = useState(""); const [bulkPrice, setBulkPrice] = useState(""); const [librarySku, setLibrarySku] = useState<string | null>(null);
  const latest = useRef({ variants, onChange, title }); latest.current = { variants, onChange, title };
  const update = (index: number, patch: Partial<VariantDraft>) => onChange(variants.map((v, i) => i === index ? { ...v, ...patch } : v));
  // Destino «size:2 lb»: la foto va a todas las presentaciones de ese tamaño (C48); si no, a una presentación por SKU.
  const place = (url: string, target: string) => {
    const current = latest.current;
    if (target.startsWith(SIZE)) {
      const key = target.slice(SIZE.length);
      const result = addToSize(current.variants, key, { url, alt: sizeAlt(current.title, key) });
      if (!result.added) throw new Error(`Foto guardada en biblioteca: las presentaciones de ${key} ya tienen ${MAX_PHOTOS} fotos.`);
      current.onChange(result.next); return;
    }
    const target_ = current.variants.find(v => v.sku === target);
    if (!target_ || target_.images.length >= MAX_PHOTOS) throw new Error("Foto guardada en biblioteca: la variante no existe o está completa.");
    current.onChange(current.variants.map(v => v.sku === target ? { ...v, images: [...v.images, { url, alt: photoAlt(current.title, v) }] } : v));
  };
  const uploads = useImageQueue(place, setBusy);
  const addImages = (index: number, files: FileList | null) => {
    if (locked) return; const target = variants[index]; if (!target) return; const list = [...files ?? []]; const capacity = MAX_PHOTOS - target.images.length;
    if (list.length > capacity) { setError(`Quedan ${capacity} espacios; máximo ${MAX_PHOTOS} fotos por variante.`); return; }
    setError(""); uploads.add(list, target.sku);
  };
  const addSizeImages = (group: SizeGroup, files: FileList | null) => {
    if (locked) return; const list = [...files ?? []];
    if (!list.length) return;
    if (list.length > group.free) { setError(`Quedan ${group.free} espacios en ${group.key}; máximo ${MAX_PHOTOS} fotos por presentación.`); return; }
    setError(""); uploads.add(list, `${SIZE}${group.key}`);
  };
  const move = (from: number, position: number, to: number, destination?: number, copy = false) => {
    if (locked || !Number.isInteger(from) || !Number.isInteger(to) || !Number.isInteger(position) || !variants[from]?.images[position] || !variants[to]) return;
    if (from !== to && variants[to]!.images.length >= MAX_PHOTOS) { setError("La variante destino ya tiene 8 imágenes"); return; }
    const next = variants.map((v) => ({ ...v, images: [...v.images] }));
    const photo = copy ? { ...next[from]!.images[position]! } : next[from]!.images.splice(position, 1)[0];
    next[to]!.images.splice(destination ?? next[to]!.images.length, 0, photo!); onChange(next);
  };
  const groups = sizeGroups(variants);
  // Solo tiene sentido si algún tamaño tiene más de un sabor; si no, las galerías por presentación ya son por tamaño.
  const bySize = groups.some(group => group.indexes.length > 1);
  const sharedIn = (variant: VariantDraft, url: string) => groups.find(group => group.key === sizeKey(variant))?.common.some(photo => photo.url === url) ?? false;
  const librarySelect = (url: string) => {
    if (librarySku?.startsWith(SIZE)) {
      const key = librarySku.slice(SIZE.length); const result = addToSize(variants, key, { url, alt: sizeAlt(title, key) });
      if (result.added) { onChange(result.next); setLibrarySku(null); } else setError(`Las presentaciones de ${key} ya tienen esa foto o están completas.`);
      return;
    }
    const index = variants.findIndex((v) => v.sku === librarySku);
    if (index >= 0 && variants[index]!.images.length < MAX_PHOTOS) { update(index, { images: [...variants[index]!.images, { url, alt: photoAlt(title, variants[index]!) }] }); setLibrarySku(null); }
    else setError("La variante no existe o ya tiene 8 imágenes");
  };
  const flavorGalleries = <div className="variant-galleries">{variants.map((v, index) => <section className="variant-gallery" key={v.sku + index} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (locked) return; if (e.dataTransfer.files.length) { void addImages(index, e.dataTransfer.files); return; } try { const drag = JSON.parse(e.dataTransfer.getData("application/x-rawenergy-photo")) as { from: number; position: number }; if (Number.isInteger(drag.from) && Number.isInteger(drag.position)) move(drag.from, drag.position, index); } catch { /* unrelated drag */ } }}><h3>{v.flavor} · {v.size.value} {v.size.unit} <small>{v.sku}</small></h3><div className="photo-strip">{v.images.map((photo, position) => <article className="photo-tile" key={`${photo.url}:${position}`} draggable={!locked} onDragStart={(e) => e.dataTransfer.setData("application/x-rawenergy-photo", JSON.stringify({ from: index, position }))} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { if (e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); try { const drag = JSON.parse(e.dataTransfer.getData("application/x-rawenergy-photo")); move(drag.from, drag.position, index, position); } catch { /* unrelated drag */ } }}><img loading="lazy" decoding="async" src={thumbnailUrl(photo.url)} alt={photo.alt} width={104} height={104} /><small>{position === 0 ? "Portada" : `Foto ${position + 1}`}{bySize && (sharedIn(v, photo.url) ? " · del tamaño" : " · solo este sabor")}</small><input aria-label={`Descripción de foto ${position + 1} de ${v.sku}`} maxLength={140} value={photo.alt} onChange={(e) => update(index, { images: v.images.map((p, i) => i === position ? { ...p, alt: e.target.value } : p) })} /><div><button type="button" aria-label="Mover foto a la izquierda" disabled={!position} onClick={() => move(index, position, index, position - 1)}>←</button><button type="button" aria-label="Mover foto a la derecha" disabled={position === v.images.length - 1} onClick={() => move(index, position, index, position + 1)}>→</button><button type="button" aria-label={`Quitar foto ${position + 1} de ${v.sku}`} onClick={() => update(index, { images: v.images.filter((_, i) => i !== position) })}>Quitar</button></div><select aria-label={`Mover foto ${position + 1} a otra variante`} value="" onChange={(e) => { if (e.target.value !== "") move(index, position, Number(e.target.value)); }}><option value="">Mover a…</option>{variants.map((target, i) => i !== index && <option key={i} value={i}>{target.flavor} · {target.size.value} {target.size.unit}</option>)}</select><select aria-label={`Copiar foto ${position + 1} a otra variante`} value="" onChange={(e) => { if (e.target.value !== "") move(index, position, Number(e.target.value), undefined, true); }}><option value="">Copiar a…</option>{variants.map((target, i) => i !== index && <option key={i} value={i}>{target.flavor} · {target.size.value} {target.size.unit}</option>)}</select></article>)}</div>{!v.images.length && <p>Suelta aquí las fotos de esta variante.</p>}</section>)}</div>;

  return <div className="matrix-wrap">
    {uploads.view}
    {error && <div className="matrix-error" role="alert">{error}</div>}
    <fieldset disabled={locked} className="matrix-fieldset"><div className="filter-bar"><label>Precio para todas las variantes<input type="number" min="0.01" step=".01" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} /></label><button type="button" disabled={!(Number(bulkPrice) > 0)} onClick={() => onChange(variants.map((v) => ({ ...v, price: Number(bulkPrice) })))}>Aplicar precio</button><small>{bySize ? "Fotos: súbelas por tamaño y se usan en todos sus sabores. La primera es la portada." : "Fotos: arrastra para ordenar o mover. La primera es la portada."}</small></div>
    <table className="matrix"><thead><tr><th>Variante</th><th>SKU</th><th>Precio</th><th>Antes</th><th>Stock / mínimo</th><th>Fotos</th></tr></thead><tbody>{variants.map((v, index) => <tr key={`${v.flavor}-${v.size.value}-${v.size.unit}`} className={v.price > 0 ? "" : "variant-draft"}>
      <td><b>{v.flavor}</b>{onRemove && <button type="button" onClick={async () => { if (await confirm({ title: "Quitar variante", message: `Quitar ${v.sku} de esta ficha. El cambio se aplica al guardar.`, danger: true, confirmLabel: "Quitar" })) onRemove(index); }}>Quitar variante</button>}<small>{v.size.value} {v.size.unit}</small>{v.price <= 0 && <em className="variant-note">Completa el precio</em>}</td>
      <td><input aria-label={`SKU ${v.flavor} ${v.size.value} ${v.size.unit}`} className="sku" maxLength={80} value={v.sku} onChange={(e) => update(index, { sku: e.target.value })} /></td>
      <td><input aria-label={`Precio ${v.sku}`} type="number" min="0" step=".01" value={v.price || ""} onChange={(e) => update(index, { price: Number(e.target.value) })} /></td>
      <td><input aria-label={`Precio anterior ${v.sku}`} type="number" min="0" step=".01" value={v.compareAtPrice ?? ""} onChange={(e) => update(index, { compareAtPrice: e.target.value ? Number(e.target.value) : null })} /></td>
      <td><input disabled={stockReadonly} aria-label={`Stock ${v.sku}`} className="stock" type="number" min="0" step="1" value={v.stock} onChange={(e) => update(index, { stock: Number(e.target.value) })} /><input aria-label={`Mínimo ${v.sku}`} title="Stock mínimo" className="stock" type="number" min="0" step="1" value={v.reorderPoint ?? 5} onChange={(e) => update(index, { reorderPoint: Number(e.target.value) })} /></td>
      <td><label className="drop-cell" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) void addImages(index, e.dataTransfer.files); }}><input type="file" accept={ACCEPT} multiple disabled={busy} onChange={(e) => { void addImages(index, e.target.files); e.target.value = ""; }} />{busy ? <Loader2 size={17} className="spin" /> : <ImagePlus size={17} />}<span>{v.images.length}/8 · Subir</span></label><button type="button" onClick={() => setLibrarySku(v.sku)}>Biblioteca</button></td>
    </tr>)}</tbody></table>

    {bySize && <section className="size-photos" aria-labelledby="size-photos-title">
      <h3 id="size-photos-title">Fotos por tamaño</h3>
      <p className="size-photos-help">Lo que subas en un tamaño se usa en todos sus sabores; la primera foto es la portada. Si un sabor necesita fotos propias (por ejemplo, su etiqueta), agrégalas abajo en «Fotos de cada sabor».</p>
      <div className="size-groups">{groups.map(group => (
        <section className="size-group" key={group.key} aria-label={`Fotos de ${group.key}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addSizeImages(group, e.dataTransfer.files); }}>
          <header><h4>{group.key}</h4><small>{group.flavors.length === 1 ? group.flavors[0] : `${group.flavors.length} sabores: ${group.flavors.join(", ")}`}</small></header>
          <div className="photo-strip">{group.common.map((photo, position) => (
            <article className="photo-tile" key={photo.url}>
              <img loading="lazy" decoding="async" src={thumbnailUrl(photo.url)} alt={photo.alt} width={104} height={104} />
              <small>{position === 0 ? "Portada" : `Foto ${position + 1}`}</small>
              <input aria-label={`Descripción de la foto ${position + 1} de ${group.key}`} maxLength={140} value={photo.alt} onChange={(e) => onChange(altInSize(variants, group.key, photo.url, e.target.value))} />
              <div>
                <button type="button" disabled={position === 0} aria-label={`Usar la foto ${position + 1} como portada de ${group.key}`} onClick={() => onChange(coverOfSize(variants, group.key, photo.url))}>Portada</button>
                <button type="button" aria-label={`Quitar la foto ${position + 1} de todos los sabores de ${group.key}`} onClick={() => onChange(removeFromSize(variants, group.key, photo.url))}>Quitar</button>
              </div>
            </article>
          ))}</div>
          {!group.common.length && <p>Aún no hay fotos comunes para {group.key}. Súbelas aquí o suéltalas en este recuadro.</p>}
          <div className="size-group-actions">
            <label className="file-pick"><input type="file" accept={ACCEPT} multiple disabled={busy || group.free <= 0} onChange={(e) => { addSizeImages(group, e.target.files); e.target.value = ""; }} />{busy ? <Loader2 size={17} className="spin" /> : <ImagePlus size={17} />}<span>Subir fotos de {group.key}</span></label>
            <button type="button" disabled={group.free <= 0} onClick={() => setLibrarySku(`${SIZE}${group.key}`)}>Elegir de la biblioteca</button>
            <small>{group.free > 0 ? `${group.free} ${group.free === 1 ? "espacio libre" : "espacios libres"}` : "Sin espacio: máximo 8 fotos por presentación"}</small>
          </div>
        </section>
      ))}</div>
    </section>}

    {bySize ? <details className="flavor-photos"><summary>Fotos de cada sabor (opcional)</summary>{flavorGalleries}</details> : flavorGalleries}
    </fieldset>
    {librarySku && <div className="report-card"><button type="button" disabled={locked} onClick={() => setLibrarySku(null)}>Cerrar biblioteca</button><Suspense fallback={<p>Cargando fotos…</p>}><Library onBusyChange={setLibraryBusy} onSelect={librarySelect} /></Suspense></div>}
    {!variants.length && <div className="empty-matrix"><PackageOpen /><b>La matriz aparecerá aquí</b><span>Agrega al menos un sabor/color y un tamaño.</span></div>}
  </div>;
}
