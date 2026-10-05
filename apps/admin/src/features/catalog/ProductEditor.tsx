import { useUnsavedChanges } from "../../components/common/UnsavedChanges";
import { updateProductIdentity } from "./productIdentity";
import { thumbnailUrl } from "../../lib/uploadImage";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Cloud, Combine, Sparkles, Upload, Package, Plus, Edit3, Trash2, RotateCcw, Copy, Star } from "lucide-react";
import { useQuery } from "@apollo/client";
import { similarBrand } from "./brandHint";
import { generateVariantMatrix, type Product, TAXONOMY, type TaxonomyOverview, type VariantDraft, useUpsertProduct } from "@vital-forge/shared-logic";

// Formatos de tamaño más usados: misma unidad en todo el catálogo («porciones», no «medidas»).
const sizeSuggestions = ["1 lb", "2 lb", "5 lb", "300 g", "600 g", "1 kg", "2 kg", "30 porciones", "60 cápsulas"];
import { formatMoney } from "@vital-forge/ui-core";
import { TagEditor } from "../../components/TagEditor";
import { VariantMatrix } from "../../components/VariantMatrix";
import { useConfirm } from "../../components/common/ConfirmDialog";
import { productDraftKey, readDraft, removeDraft, writeDraft, useAutoDraft } from "../product/useAutoDraft";
import { initial, isProductForm, normalizeForm, parseSize, productFormToPayload, productToForm, recoverProductDraft, slugify, validateProductForm, type FormState } from "./productForm";
type DataStatus = "ok" | "loading" | "error";
const emptyCopy = (status: DataStatus, ok: string, loading: string, error: string) => status === "error" ? error : status === "loading" ? loading : ok;

const goalOptions = [
  { name: "Desarrollo Muscular", helper: "Proteinas, creatinas y mass gainers" },
  { name: "Energia", helper: "Pre entrenos, cafeina y enfoque" },
  { name: "Recuperacion", helper: "Proteina, aminoacidos e hidratacion" },
  { name: "Perdida de grasa", helper: "Termogenicos, snacks fit y control" }
];


export function ProductEditor({ ownerId, product, onDone, onCancel, onDirtyChange, canManageStock = true }: { ownerId: string; product?: Product | null; onDone: () => void; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void; canManageStock?: boolean }) {
  const confirm = useConfirm();
  const activeDraftKey = productDraftKey(ownerId, product?.id);
  const base = useMemo(() => normalizeForm(product ? productToForm(product) : { ...initial, variants: generateVariantMatrix("", initial.flavors, initial.sizes.map(parseSize)) }), [product]);
  const [form, setForm] = useState<FormState>(base);
  const [pendingDraft, setPendingDraft] = useState<FormState | null>(() => readDraft<FormState | null>(activeDraftKey, null, isProductForm));
  const [advanced, setAdvanced] = useState(Boolean(product));
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const dirty = !saved && JSON.stringify(form) !== JSON.stringify(base);
  useUnsavedChanges(dirty, {persist: () => { if (!pendingDraft && !writeDraft(activeDraftKey, form)) throw new Error("No se pudo conservar el borrador"); }});
  useEffect(() => {
    onDirtyChange?.(dirty);
    const persist=()=>{if(dirty&&!pendingDraft)writeDraft(activeDraftKey,form);};
    const handler=(e:BeforeUnloadEvent)=>{if(dirty){persist();e.preventDefault();}};
    window.addEventListener("beforeunload",handler);window.addEventListener("rawenergy:save-draft",persist);
    return()=>{window.removeEventListener("beforeunload",handler);window.removeEventListener("rawenergy:save-draft",persist);};
  },[dirty,form,activeDraftKey,pendingDraft,onDirtyChange]);
  const [toast, setToast] = useState("");
  const [blocked, setBlocked] = useState("");
  const draftStatus = useAutoDraft(activeDraftKey, form, dirty && !pendingDraft);
  const [uploading, setUploading] = useState(false);
  const { saveProduct, loading, error } = useUpsertProduct();
  useUnsavedChanges(false, {busy: uploading || loading});
  const generated = useMemo(() => generateVariantMatrix(form.slug, form.flavors, form.sizes.map(parseSize), form.variants), [form.slug, form.flavors, form.sizes, form.variants]);


  const change = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const taxonomy = useQuery<{ taxonomy: TaxonomyOverview }>(TAXONOMY);
  const brandNames = taxonomy.data?.taxonomy.brands.map((brand) => brand.name) ?? [];
  const brandHint = similarBrand(form.brand, brandNames);
  const toggleGoal = (goal: string) => setForm((current) => {
    const exists = current.goals.includes(goal);
    const goals = exists ? current.goals.filter((item) => item !== goal) : [...current.goals, goal];
    return { ...current, goals: goals.length ? goals : [goal] };
  });
  const updateTitle = (title: string) => setForm(current => ({...current,...updateProductIdentity(current,title,Boolean(product?.id))}));
  const priceRange = form.variants.some((v) => v.price > 0) ? { min: Math.min(...form.variants.filter((v) => v.price > 0).map((v) => v.price)), max: Math.max(...form.variants.map((v) => v.price || 0)) } : { min: 0, max: 0 };
  const checks = [form.title.trim().length >= 3, form.brand.trim().length >= 2, /^[a-z0-9-]+$/.test(form.slug), form.description.trim().length >= 10, Boolean(form.categories.trim()), form.goals.length > 0, form.variants.some((v) => v.price > 0), form.variants.every((v) => Number.isInteger(v.stock) && v.stock >= 0), form.variants.some((v) => v.images.length > 0), form.productType === "APPAREL" || Boolean(form.servingSize.trim())];
  const completion = `${Math.round(checks.filter(Boolean).length / checks.length * 100)}%`;

  const submit = async () => {
    if (submitting.current || loading || uploading || saved || pendingDraft) return;
    const errors = validateProductForm(form);
    if (errors.length) { setBlocked(errors.join(" · ")); document.getElementById("product-validation")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    setBlocked("");
    submitting.current = true;
    const payload = productFormToPayload(form, product);
    try { await saveProduct(payload, product?.id || undefined, product?.id ? form.sourceStocks ?? product.variants.map((v) => ({ sku: v.sku, stock: v.stock })) : undefined, product?.id ? form.sourceRevision ?? product.revision ?? 0 : undefined); }
    catch (cause) { submitting.current = false; setBlocked(cause instanceof Error ? cause.message : "No se pudo guardar el producto"); return; }
    setSaved(true);
    removeDraft(activeDraftKey);
    setToast(product ? "Producto actualizado correctamente" : "Producto publicado correctamente");
    setTimeout(() => setToast(""), 3000);
    onDirtyChange?.(false);
    onDone();
  };

  return (
    <fieldset className="matrix-fieldset" disabled={loading || uploading || saved} aria-label="Ficha de producto" aria-busy={loading || uploading}>
      <div className="page-head">
        <button className="back" onClick={onCancel} aria-label="Volver a productos"><ArrowLeft aria-hidden="true" /></button>
        <div><span className="kicker"><Sparkles /> {product?.id ? "Editar producto" : "Carga rápida"}</span><h1>{product ? product.title : "Nuevo producto"}</h1><p>Datos comerciales, stock, fotos y mensajes visibles en una sola vista.</p></div>
        <div className="completion"><span>Completitud <b>{completion}</b></span><i><em style={{ width: completion }} /></i></div>
      </div>

      <div className="catalog-toolbar">
        {!canManageStock && <p className="method-note">Tu perfil administra la ficha y las fotografías. Las existencias se ingresan desde Inventario y compras.</p>}
        {pendingDraft && <div className="inline-notice">Hay un borrador de tu cuenta guardado en este dispositivo. <button onClick={() => { setForm(recoverProductDraft(base, pendingDraft)); setPendingDraft(null); }}>Recuperar borrador</button><button onClick={() => { setPendingDraft(null); removeDraft(activeDraftKey); }}>Descartar borrador</button></div>}
        {product?.id && form.sourceRevision !== undefined && form.sourceRevision !== (product.revision ?? 0) && <p className="field-error" role="alert">Este borrador parte de una versión anterior del producto. Se conserva tu trabajo; revisa la ficha actual antes de aplicar los cambios para evitar sobrescribir los de otra persona.</p>}
        <div className="segmented-control" role="group" aria-label="Tipo de ficha"><button type="button" aria-pressed={!advanced} className={!advanced ? "selected" : ""} onClick={() => setAdvanced(false)}>Carga rápida</button><button type="button" aria-pressed={advanced} className={advanced ? "selected" : ""} onClick={() => setAdvanced(true)}>Ficha completa</button></div>
        {!product && <label>Plantilla de categoría<select disabled={!!pendingDraft} defaultValue="" onChange={(e) => { const kind = e.target.value; if (!kind) return;
          setForm(current=>{const apparel=kind==="Ropa deportiva";const flavors=[apparel?"Negro":"Natural"];const sizes=[apparel?"1 M":kind==="Proteína Whey"?"2 lb":"300 g"];const untouched=current.variants.length===1&&current.variants.every(v=>v.price===0&&v.stock===0&&!v.images.length);return {...current,categories:kind,productType:apparel?"APPAREL":"SUPPLEMENT",goals:[apparel?"Entrenamiento":kind==="Preentreno"?"Energia":"Desarrollo Muscular"],...(untouched?{flavors,sizes,variants:generateVariantMatrix(current.slug,flavors,sizes.map(parseSize))}:{})};}); }}><option value="">Elegir plantilla</option><option>Proteína Whey</option><option>Creatina</option><option>Preentreno</option><option>Ropa deportiva</option></select></label>}
        <div id="product-validation" role="alert">{blocked && <p className="field-error">{blocked}</p>}</div>
      </div>
      <fieldset className="form-grid matrix-fieldset" disabled={!!pendingDraft}>
        <div className="form-content">
          <section className="panel">
            <header><i>01</i><div><h2>Datos del producto</h2><p>La información que verá el cliente primero.</p></div></header>
            <div className="fields two">
              <label><span>Nombre del producto</span><input maxLength={120} aria-invalid={!!blocked && form.title.trim().length<3} value={form.title} onChange={(event) => updateTitle(event.target.value)} placeholder="Ej. Gold Standard 100% Whey" /></label>
              <label><span>Marca</span><input maxLength={80} list="marcas-existentes" aria-invalid={!!blocked && form.brand.trim().length<2} aria-describedby={brandHint ? "marca-parecida" : undefined} value={form.brand} onChange={(event) => change("brand", event.target.value)} placeholder="Ej. Raw Nutrition" />
                <datalist id="marcas-existentes">{brandNames.map((name) => <option key={name} value={name} />)}</datalist>
                {brandHint && <small id="marca-parecida" className="field-warning">Ya existe «{brandHint}». <button type="button" className="link-button" onClick={() => change("brand", brandHint)}>Usar «{brandHint}»</button> para no duplicar la marca.</small>}</label>
              <label hidden={!advanced}><span>Identificador del enlace</span><div className="slug"><small>rawenergy.ec/p/</small><input maxLength={160} value={form.slug} onChange={(event) => change("slug", slugify(event.target.value))} /></div></label>
              <label><span>Tipo de producto</span><select value={form.productType} onChange={(event) => change("productType", event.target.value as FormState["productType"])}><option value="SUPPLEMENT">Suplemento deportivo</option><option value="APPAREL">Ropa deportiva</option></select></label>
              <label className="full"><span>Descripción corta</span><textarea aria-invalid={!!blocked && form.description.trim().length<10} maxLength={320} value={form.description} onChange={(event) => change("description", event.target.value)} placeholder="Resume el beneficio principal, el uso y por que comprarlo en RawEnergy EC." /><small>{form.description.length}/320</small></label>
              {/* Datos de la etiqueta (C66, V19): se muestran en la ficha solo si se cargan. No se inventan. */}
              <label className="full"><span>Ingredientes <small>según la etiqueta (opcional)</small></span><textarea maxLength={1500} value={form.ingredients ?? ""} onChange={(event) => change("ingredients", event.target.value)} placeholder="Ej. Proteína de suero aislada, saborizante natural…" /><small>{(form.ingredients ?? "").length}/1500</small></label>
              <label className="full"><span>Modo de uso <small>según la etiqueta (opcional)</small></span><textarea maxLength={1000} value={form.usage ?? ""} onChange={(event) => change("usage", event.target.value)} placeholder="Ej. Mezcla 1 medida con 200 ml de agua después de entrenar." /><small>{(form.usage ?? "").length}/1000</small></label>
              <label className="full"><span>Advertencias <small>según la etiqueta (opcional)</small></span><textarea maxLength={1000} value={form.warnings ?? ""} onChange={(event) => change("warnings", event.target.value)} placeholder="Ej. Contiene cafeína. No apto para menores de 18 años." /><small>{(form.warnings ?? "").length}/1000</small></label>
            </div>
          </section>

          {form.productType === "SUPPLEMENT" && <section className="panel">
            <header><i>02</i><div><h2>Información nutricional</h2><p>Valores por porción, tal como aparecen en la etiqueta. Deja vacío lo que la etiqueta no declara: la tienda mostrará «No declarado».</p></div></header>
            <div className="nutrition">
              <label><span>Tamaño de porción</span><input value={form.servingSize} onChange={(event) => change("servingSize", event.target.value)} /></label>
              {[
                ["Calorías", "calories"],
                ["Proteína (g)", "protein"],
                ["Carbohidratos (g)", "carbs"],
                ["Grasas (g)", "fats"]
              ].map(([label, key]) => <label key={key}><span>{label}</span><input type="number" min="0" step="any" placeholder="No declarado" value={(form[key as keyof FormState] as number | null) ?? ""} onChange={(event) => change(key as keyof FormState, (event.target.value === "" ? null : Number(event.target.value)) as never)} /></label>)}
            </div>
          </section>}

          <section className="panel matrix-panel">
            <header><i>{form.productType === "SUPPLEMENT" ? "03" : "02"}</i><div><h2>Variantes y fotografías</h2><p>Combina opciones. La tabla hace el trabajo pesado.</p></div><span className="matrix-count">{form.variants.length} variantes</span></header>
            <div className="option-editors"><TagEditor label={form.productType === "APPAREL" ? "Colores" : "Sabores"} values={form.flavors} onChange={(value) => change("flavors", value)} placeholder="Agregar opción" /><b>×</b><TagEditor label="Tamaños" values={form.sizes} onChange={(value) => change("sizes", value)} placeholder="Ej. 5 lb" suggestions={sizeSuggestions} /></div>
            <div className="variant-choice"><p>La tabla contiene solo las variantes que vas a vender. Agrega combinaciones cuando las necesites.</p><button type="button" onClick={async () => {
              const added=generated.filter(v=>!form.variants.some(old=>old.flavor===v.flavor && old.size.value===v.size.value && old.size.unit===v.size.unit));
              if (!added.length) { setBlocked("Agrega una opción o tamaño nuevo para generar más combinaciones."); return; }
              if (form.variants.length+added.length>120 || added.some(v=>!v.flavor.trim() || v.flavor.trim().length>80 || !Number.isFinite(v.size.value) || v.size.value<=0 || !v.size.unit.trim() || v.size.unit.trim().length>12)) { setBlocked("Revisa las opciones y tamaños: usa cantidades positivas (por ejemplo, 2 lb o 1,5 kg), unidades de hasta 12 caracteres y un máximo de 120 variantes."); return; }
              if (await confirm({ title: "Agregar combinaciones", message: `Se agregarán ${added.length} combinaciones. Las variantes existentes conservarán sus datos.`, confirmLabel: "Agregar" })) { setBlocked(""); change("variants", [...form.variants, ...added]); }
            }}>Generar combinaciones</button></div>
            <VariantMatrix disabled={loading || saved || !!pendingDraft} stockReadonly={!canManageStock} onRemove={(index) => change("variants", form.variants.filter((_, i) => i !== index))} onBusyChange={setUploading} variants={form.variants} onChange={(variants) => change("variants", variants)} title={form.title} />
          </section>

          <section className="panel">
            <header><i>{form.productType === "SUPPLEMENT" ? "04" : "03"}</i><div><h2>Categorías y beneficios</h2><p>Organiza el producto y configura sus beneficios.</p></div></header>
            <div className="fields two">
              <label><span>Categorías <small>separadas por coma</small></span><input aria-invalid={!!blocked && !form.categories.trim()} aria-describedby="categorias-existentes" value={form.categories} onChange={(event) => change("categories", event.target.value)} />
                {!!taxonomy.data?.taxonomy.categories.length && <small id="categorias-existentes">Existentes: {taxonomy.data.taxonomy.categories.map((category) => category.name).join(", ")}. Escríbelas igual para no crear tipos repetidos.</small>}</label>
              <div className="field-block full">
                <TagEditor label="Objetivos" values={form.goals} onChange={(value) => change("goals", value)} placeholder="Agregar objetivo" suggestions={taxonomy.data?.taxonomy.goals.map((goal) => goal.name)} />
                <span>Objetivos del cliente <small>elige uno o varios</small></span>
                <div className="goal-picker">
                  {goalOptions.map((goal) => (
                    <button className={form.goals.includes(goal.name) ? "selected" : ""} type="button" key={goal.name} onClick={() => toggleGoal(goal.name)}>
                      <b>{goal.name}</b>
                      <small>{goal.helper}</small>
                    </button>
                  ))}
                </div>
              </div>
              <label className="switch-row"><span><b>Destacado en tienda</b><small>Aparece primero en la experiencia cliente</small></span><input type="checkbox" checked={form.featured} onChange={(event) => change("featured", event.target.checked)} /></label>
            </div>
          </section>
        </div>

        <aside className="summary">
          <div className="summary-card">
            <span className="overline">Vista rápida</span>
            <div className="product-placeholder">{form.variants[0]?.images[0] ? <img src={form.variants[0].images[0].url} alt="" /> : <><Package /><span>Agrega una imagen</span></>}</div>
            <small>{form.brand || "TU MARCA"}</small>
            <h3>{form.title || "Nombre del producto"}</h3>
            <p>{form.description || "Tu descripción aparecerá aquí mientras completas el producto."}</p>
            <strong>{priceRange.min === priceRange.max ? formatMoney(priceRange.min) : `Desde ${formatMoney(priceRange.min)}`}</strong>
            <div className="summary-stats"><span><b>{form.variants.length}</b>Variantes</span><span><b>{form.variants.reduce((sum, variant) => sum + variant.stock, 0)}</b>Unidades</span></div>
          </div>
          <div className="tip"><Sparkles /><div><b>Consejo RawEnergy</b><p>Incluye frente, etiqueta y presentación. Usa la primera foto como portada y ordena las demás desde la galería.</p></div></div>
        </aside>
      </fieldset>
      {(error || blocked || toast) && <div className={`toast ${error || blocked ? "error" : ""}`}>{error ? error.message : blocked || <><Check /> {toast}</>}</div>}
      <div className="floating-actions"><span className={`draft ${draftStatus}`}><Cloud />{draftStatus === "saving" ? "Guardando borrador..." : draftStatus === "error" ? "No se pudo guardar el borrador en este navegador" : pendingDraft ? "Borrador pendiente de recuperar" : draftStatus === "saved" ? "Borrador guardado para tu cuenta" : "Sin cambios pendientes"}</span><button className="publish" onClick={submit} disabled={loading || uploading || saved || !!pendingDraft}><Upload />{uploading ? "Subiendo fotografías..." : loading ? "Guardando..." : product?.id ? "Guardar cambios" : "Publicar"}</button></div>
    </fieldset>
  );
}

export function ProductList({ products, total, showArchived, featuredOnly, dataStatus, onToggleArchived, onToggleFeaturedOnly, onFeatured, onCreate, onEdit, onArchive, onRestore, onDuplicate, onHistory, onMerge, readonly = false }: {
  products: Product[];
  total: number;
  showArchived: boolean;
  featuredOnly: boolean;
  dataStatus: DataStatus;
  onToggleArchived: (value: boolean) => void;
  onToggleFeaturedOnly: (value: boolean) => void;
  /** Marca o quita el producto de «Destacados de la tienda» sin abrir la ficha. */
  onFeatured: (product: Product) => void;
  onCreate: () => void;
  onEdit: (product: Product) => void;
  onArchive: (product: Product) => void;
  onRestore: (product: Product) => void;
  onDuplicate?: (product: Product) => void;
  onHistory?: (product: Product) => void;
  /** Unir como presentación de otro producto (C49); solo Administración. */
  onMerge?: (product: Product) => void;
  readonly?: boolean;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // La confirmación reemplaza los botones de la fila: el foco va a «Cancelar» y vuelve a «Archivar» al cancelar (C41).
  const focusRow = (id: string, selector: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-product-row="${CSS.escape(id)}"] ${selector}`)?.focus());
  const askArchive = (id: string) => { setConfirmingId(id); focusRow(id, "[data-confirm-cancel]"); };
  const cancelArchive = (id: string) => { setConfirmingId(null); focusRow(id, "[data-archive]"); };
  return (
    <section className="admin-section">
      <header>
        <div><span className="kicker"><Package /> Catálogo</span><h1>Productos</h1><p>{emptyCopy(dataStatus, `${total} productos disponibles.`, "Cargando productos...", "No se pudieron cargar los productos.")}</p></div>
        <label className="archived-toggle"><input type="checkbox" checked={featuredOnly} onChange={(event) => onToggleFeaturedOnly(event.target.checked)} /> Solo destacados</label>
        <label className="archived-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => onToggleArchived(event.target.checked)} /> Ver archivados</label>
        <button hidden={readonly} className="publish" onClick={onCreate}><Plus />Nuevo producto</button>
      </header>
      {!products.length && (
        <div className="empty-state">
          {emptyCopy(
            dataStatus,
            showArchived ? "No hay productos que mostrar." : "Aún no hay productos publicados.",
            "Cargando productos...",
            "No se pudieron cargar los productos."
          )}
        </div>
      )}
      <div className="crud-table">
        {products.map((product) => (
          <article className={`crud-row ${product.active ? "" : "archived"}`} key={product.id} data-product-row={product.id}>
            <div className="crud-thumb">{product.primaryImage ? <img src={thumbnailUrl(product.primaryImage.url)} alt="" loading="lazy" decoding="async" width={64} height={64} /> : <Package />}</div>
            <div>
              <b>{product.title}</b>
              <span>{product.brand} · {product.categories[0]?.name ?? product.productType}</span>
              {!product.active && <em className="archived-badge">Archivado</em>}
              {product.featured && product.active && <em className="featured-badge">Destacado en la tienda</em>}
            </div>
            <strong>{product.priceRange.min === product.priceRange.max ? formatMoney(product.priceRange.min) : `${formatMoney(product.priceRange.min)} - ${formatMoney(product.priceRange.max)}`}</strong>
            <small>{product.variants.reduce((sum, variant) => sum + variant.stock, 0)} unidades</small>
            <div className="row-actions">
              {confirmingId === product.id ? (
                <>
                  <span className="confirm-copy" id={`archivar-${product.id}`} role="status">¿Archivar "{product.title}"?</span>
                  <button className="danger" aria-describedby={`archivar-${product.id}`} onClick={() => { onArchive(product); setConfirmingId(null); }} onKeyDown={event => { if (event.key === "Escape") cancelArchive(product.id); }}>Sí, archivar</button>
                  <button data-confirm-cancel aria-describedby={`archivar-${product.id}`} onClick={() => cancelArchive(product.id)} onKeyDown={event => { if (event.key === "Escape") cancelArchive(product.id); }}>Cancelar</button>
                </>
              ) : (
                <>
                  {product.active && <button hidden={readonly} className={product.featured ? "featured-toggle is-on" : "featured-toggle"} aria-pressed={!!product.featured} onClick={() => onFeatured(product)} title={product.featured ? "Quitar de Destacados de la tienda" : "Mostrar en Destacados de la tienda"}><Star />{product.featured ? "Destacado" : "Destacar"}</button>}
                  <button hidden={readonly} onClick={() => onEdit(product)} aria-label={`Editar ${product.title}`}><Edit3 />Editar</button>
                  <button hidden={readonly} onClick={() => onDuplicate?.(product)} aria-label={`Duplicar ${product.title}`}><Copy />Duplicar</button>
                  {onMerge && <button onClick={() => onMerge(product)} aria-label={`Unir ${product.title} como presentación de otro producto`}><Combine />Unir a otro</button>}
                  {onHistory && <button onClick={() => onHistory(product)} aria-label={`Historial de ${product.title}`}>Historial</button>}
                  {!readonly && (product.active
                    ? <button className="danger" data-archive onClick={() => askArchive(product.id)} aria-label={`Archivar ${product.title}`}><Trash2 />Archivar</button>
                    : <button onClick={() => onRestore(product)} aria-label={`Restaurar ${product.title}`}><RotateCcw />Restaurar</button>)}
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
