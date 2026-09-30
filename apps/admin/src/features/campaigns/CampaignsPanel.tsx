import { ApolloError, gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Image as ImageIcon, Megaphone, Pause, Play, Plus, Search, Trash2, X } from "lucide-react";
import { ADMIN_CAMPAIGNS, DELETE_CAMPAIGN, GET_ADMIN_PRODUCTS, SAVE_CAMPAIGN, TAXONOMY, type CampaignRecord, type CampaignStatus, type CampaignTheme, type Product, type ProductConnection, type TaxonomyOverview } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { useConfirm } from "../../components/common/ConfirmDialog";
import { useLeaveGuard, useUnsavedChanges } from "../../components/common/UnsavedChanges";
import { thumbnailUrl } from "../../lib/uploadImage";
import "./campaigns.css";

const Library = lazy(() => import("../../components/SystemPanels").then(module => ({ default: module.MediaPanel })));
const BRANDS = gql`query CampaignBrands { catalogBrands }`;

type Form = {
  id: string; revision?: number; slug: string; title: string; eyebrow: string; message: string; ctaLabel: string; theme: CampaignTheme;
  startsOn: string; endsOn: string; active: boolean; priority: number; goals: string[]; brands: string[]; productIds: string[]; imageUrl: string;
};
const themes: Array<{ value: CampaignTheme; label: string; note: string }> = [
  { value: "NOCHE", label: "Noche", note: "Oscuro con acento lima" },
  { value: "ORO", label: "Oro", note: "Oscuro con acento dorado" },
  { value: "CLARO", label: "Claro", note: "Fondo claro, texto oscuro" }
];
const statusLabels: Record<CampaignStatus, string> = { LIVE: "En portada ahora", SCHEDULED: "Programada", ENDED: "Finalizada", PAUSED: "Pausada" };
const localToday = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
const plusDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("es-EC", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const slugify = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const toForm = (row: CampaignRecord): Form => ({ id: row.id, revision: row.revision, slug: row.slug, title: row.title, eyebrow: row.eyebrow, message: row.message, ctaLabel: row.ctaLabel, theme: row.theme, startsOn: row.startsOn, endsOn: row.endsOn, active: row.active, priority: row.priority, goals: row.goals, brands: row.brands, productIds: row.productIds, imageUrl: row.imageUrl });
const input = ({ id: _id, revision: _revision, ...rest }: Form) => rest;

/** Mensaje útil del servidor: el primer problema de validación, no «Datos de entrada inválidos». */
function errorText(error: unknown) {
  if (error instanceof ApolloError) {
    const issue = (error.graphQLErrors[0]?.extensions?.issues as Array<{ message?: string }> | undefined)?.[0]?.message;
    return issue ?? error.graphQLErrors[0]?.message ?? error.message;
  }
  return error instanceof Error ? error.message : "No se pudo guardar la campaña.";
}

function Preview({ form, products }: { form: Form; products: Product[] }) {
  const photos = products.slice(0, 3);
  return (
    <div className={`campaign-preview theme-${form.theme.toLowerCase()}`} aria-label="Vista previa de la diapositiva">
      <div className="campaign-preview-copy">
        <span>{form.eyebrow || "Etiqueta"}</span>
        <h3>{form.title || "Título de la campaña"}</h3>
        <p>{form.message || "Mensaje breve para el cliente."}</p>
        <b>{form.ctaLabel || "Ver la selección"} →</b>
      </div>
      <div className="campaign-preview-media">
        {form.imageUrl ? <img src={form.imageUrl} alt="" /> : photos.length ? photos.map(product => (
          <figure key={product.id}>
            {product.primaryImage ? <img src={thumbnailUrl(product.primaryImage.url)} alt="" /> : <Megaphone />}
            <figcaption>{product.title}<small>{formatMoney(product.priceRange.min)}</small></figcaption>
          </figure>
        )) : <p>Elige objetivos, marcas o productos para ver la selección.</p>}
      </div>
    </div>
  );
}

export function CampaignsPanel({ webUrl }: { webUrl: string }) {
  const client = useApolloClient(), confirm = useConfirm(), leave = useLeaveGuard();
  const list = useQuery<{ adminCampaigns: { today: string; rows: CampaignRecord[] } }>(ADMIN_CAMPAIGNS, { fetchPolicy: "cache-and-network" });
  const taxonomy = useQuery<{ taxonomy: TaxonomyOverview }>(TAXONOMY);
  const brands = useQuery<{ catalogBrands: string[] }>(BRANDS);
  const catalog = useQuery<{ searchProducts: ProductConnection }>(GET_ADMIN_PRODUCTS, { variables: { filters: { status: "ACTIVE" }, pagination: { first: 100 } } });
  const [save] = useMutation(SAVE_CAMPAIGN), [remove] = useMutation(DELETE_CAMPAIGN);
  const [form, setForm] = useState<Form | null>(null), [baseline, setBaseline] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false), [libraryBusy, setLibraryBusy] = useState(false);
  const [message, setMessage] = useState(""), [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false); const working = useRef(false);
  useUnsavedChanges(Boolean(form && JSON.stringify(form) !== baseline), { busy: busy || libraryBusy });
  useEffect(() => { if (form) document.getElementById("campaign-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [form?.id]);

  // Primero lo que el cliente ve hoy, luego lo próximo por fecha; pausadas y finalizadas al final.
  const rows = useMemo(() => {
    const order: Record<CampaignStatus, number> = { LIVE: 0, SCHEDULED: 1, PAUSED: 2, ENDED: 3 };
    return [...(list.data?.adminCampaigns.rows ?? [])].sort((a, b) => order[a.status] - order[b.status] || (a.status === "LIVE" ? b.priority - a.priority : a.startsOn.localeCompare(b.startsOn)));
  }, [list.data]);
  const products = useMemo(() => catalog.data?.searchProducts.edges.map(edge => edge.node) ?? [], [catalog.data]);
  const byId = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const selection = useMemo(() => {
    if (!form) return [];
    const picked = form.productIds.map(id => byId.get(id)).filter((product): product is Product => Boolean(product));
    const matched = products.filter(product => (form.goals.length || form.brands.length)
      && (!form.goals.length || product.goals.some(goal => form.goals.includes(goal.slug)))
      && (!form.brands.length || form.brands.some(brand => product.brand.toLowerCase().includes(brand.toLowerCase())))
      && product.variants.some(variant => variant.stock > 0));
    return [...new Map([...picked, ...matched].map(product => [product.id, product])).values()];
  }, [form, products, byId]);
  const results = productSearch.trim().length >= 2 && form
    ? products.filter(product => !form.productIds.includes(product.id) && `${product.title} ${product.brand}`.toLowerCase().includes(productSearch.trim().toLowerCase())).slice(0, 8)
    : [];

  const open = async (row?: CampaignRecord) => {
    if (!await leave()) return;
    const today = localToday();
    const next: Form = row ? toForm(row) : { id: crypto.randomUUID(), slug: "", title: "", eyebrow: "", message: "", ctaLabel: "Ver la selección", theme: "NOCHE", startsOn: today, endsOn: plusDays(today, 30), active: true, priority: 50, goals: [], brands: [], productIds: [], imageUrl: "" };
    setForm(next); setBaseline(JSON.stringify(next)); setSlugTouched(Boolean(row)); setProductSearch(""); setLibraryOpen(false); setMessage(""); setFailure("");
  };
  const change = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => {
    if (!current) return current;
    const next = { ...current, [key]: value };
    if (key === "title" && !slugTouched) next.slug = slugify(String(value));
    return next;
  });
  const toggle = (key: "goals" | "brands", value: string) => form && change(key, form[key].includes(value) ? form[key].filter(item => item !== value) : [...form[key], value]);
  const run = async (work: () => Promise<unknown>, success: string) => {
    if (working.current) return;
    working.current = true; setBusy(true); setFailure(""); setMessage("");
    try {
      await work(); setMessage(success);
      await client.refetchQueries({ include: [ADMIN_CAMPAIGNS] }).catch(() => setFailure("Se guardó, pero no se pudo actualizar la lista. Vuelve a cargarla."));
    } catch (error) { setFailure(errorText(error)); throw error; }
    finally { working.current = false; setBusy(false); }
  };
  const submit = () => form && run(() => save({ variables: { id: form.id, input: input(form), revision: form.revision ?? null } }), form.revision === undefined ? "Campaña creada." : "Campaña actualizada.").then(() => setForm(null)).catch(() => {});
  const setActive = (row: CampaignRecord) => run(() => save({ variables: { id: row.id, input: input({ ...toForm(row), active: !row.active }), revision: row.revision } }), row.active ? "Campaña pausada: ya no aparece en la tienda." : "Campaña activada.").catch(() => {});
  const destroy = async (row: CampaignRecord) => {
    if (!await confirm({ title: "Eliminar campaña", message: `«${row.title}» dejará de existir. Si solo quieres ocultarla, usa Pausar.`, confirmLabel: "Eliminar", danger: true })) return;
    await run(() => remove({ variables: { id: row.id, revision: row.revision } }), "Campaña eliminada.").catch(() => {});
  };
  const live = rows.filter(row => row.status === "LIVE");

  return (
    <section className="admin-section campaigns-panel">
      <header>
        <div>
          <span className="kicker"><Megaphone /> Tienda · Portada</span>
          <h1>Campañas de portada</h1>
          <p>El carrusel principal muestra las campañas activas dentro de sus fechas, de mayor a menor prioridad. Cada una tiene su propia página con sus productos y precios vigentes.</p>
        </div>
        <button className="publish" onClick={() => void open()}><Plus />Nueva campaña</button>
      </header>
      <p className="campaigns-live" role="status">{list.loading && !rows.length ? "Cargando campañas…" : live.length ? `En portada ahora (${live.length}): ${live.map(row => row.title).join(" · ")}` : "Ninguna campaña está en portada: la tienda muestra los mensajes generales."}</p>
      {message && <p className="admin-success" role="status">{message}</p>}
      {(failure || list.error) && <div className="admin-alert" role="alert"><span>{failure || list.error?.message}</span><button onClick={() => void list.refetch().catch(() => {})}>Actualizar lista</button></div>}

      {form && (
        <article className="campaign-editor" id="campaign-editor">
          <form onSubmit={event => { event.preventDefault(); void submit(); }}>
            <fieldset disabled={busy} className="campaign-form">
              <h2>{form.revision === undefined ? "Nueva campaña" : "Editar campaña"}</h2>
              <label>Título <small>{form.title.length}/70</small><input required minLength={5} maxLength={70} value={form.title} onChange={event => change("title", event.target.value)} placeholder="Ej. Vuelve a tu rutina con todo" /></label>
              <div className="fields two">
                <label>Etiqueta superior <small>{form.eyebrow.length}/40</small><input required minLength={3} maxLength={40} value={form.eyebrow} onChange={event => change("eyebrow", event.target.value)} placeholder="Ej. Septiembre en marcha" /></label>
                <label>Texto del botón<input required minLength={3} maxLength={30} value={form.ctaLabel} onChange={event => change("ctaLabel", event.target.value)} /></label>
              </div>
              <label>Mensaje <small>{form.message.length}/180 · sin descuentos ni beneficios que no puedas demostrar</small><textarea required minLength={10} maxLength={180} value={form.message} onChange={event => change("message", event.target.value)} /></label>
              <label>Dirección en la tienda<span className="slug-field"><span>/campana/</span><input required minLength={3} maxLength={60} pattern="[a-z0-9-]+" value={form.slug} onChange={event => { setSlugTouched(true); change("slug", slugify(event.target.value)); }} /></span></label>
              <fieldset className="theme-picker"><legend>Estilo</legend>
                {themes.map(theme => <label key={theme.value} className={`theme-option theme-${theme.value.toLowerCase()}`}><input type="radio" name="theme" checked={form.theme === theme.value} onChange={() => change("theme", theme.value)} /><span><b>{theme.label}</b><small>{theme.note}</small></span></label>)}
              </fieldset>
              <div className="fields three">
                <label>Desde<input type="date" required value={form.startsOn} onChange={event => change("startsOn", event.target.value)} /></label>
                <label>Hasta<input type="date" required min={form.startsOn} value={form.endsOn} onChange={event => change("endsOn", event.target.value)} /></label>
                <label>Prioridad <small>mayor = primero</small><input type="number" min={0} max={100} step={1} required value={form.priority} onChange={event => change("priority", Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))))} /></label>
              </div>
              <label className="switch-row"><span><b>Activa</b><small>Pausada no se muestra aunque esté dentro de sus fechas.</small></span><input type="checkbox" checked={form.active} onChange={event => change("active", event.target.checked)} /></label>

              <fieldset className="selection"><legend>Productos de la campaña</legend>
                <p>Se muestran primero los productos que elijas y después los que coinciden con los objetivos o marcas y tienen existencias.</p>
                <div className="chip-options" role="group" aria-label="Objetivos">{taxonomy.data?.taxonomy.goals.map(goal => <label key={goal.key}><input type="checkbox" checked={form.goals.includes(goal.key)} onChange={() => toggle("goals", goal.key)} />{goal.name}</label>)}</div>
                <div className="chip-options" role="group" aria-label="Marcas">{brands.data?.catalogBrands.map(brand => <label key={brand}><input type="checkbox" checked={form.brands.includes(brand)} onChange={() => toggle("brands", brand)} />{brand}</label>)}</div>
                <label className="product-search"><Search size={16} /><input value={productSearch} onChange={event => setProductSearch(event.target.value)} placeholder="Buscar un producto para elegirlo a mano" aria-label="Buscar producto para la campaña" /></label>
                {!!results.length && <ul className="product-results">{results.map(product => <li key={product.id}><span>{product.title}<small>{product.brand}</small></span><button type="button" disabled={form.productIds.length >= 12} onClick={() => { change("productIds", [...form.productIds, product.id]); setProductSearch(""); }}>Elegir</button></li>)}</ul>}
                {!!form.productIds.length && <ul className="picked">{form.productIds.map(id => <li key={id}>{byId.get(id)?.title ?? "Producto archivado o no disponible"}<button type="button" aria-label={`Quitar ${byId.get(id)?.title ?? "producto"}`} onClick={() => change("productIds", form.productIds.filter(item => item !== id))}><X size={14} /></button></li>)}</ul>}
              </fieldset>

              <fieldset className="selection"><legend>Foto de portada (opcional)</legend>
                <p>Si no eliges una, la diapositiva muestra las fotos de los productos de la campaña.</p>
                <div className="image-actions">
                  <button type="button" onClick={() => setLibraryOpen(value => !value)}><ImageIcon size={16} />{libraryOpen ? "Cerrar biblioteca" : "Elegir de la biblioteca"}</button>
                  {form.imageUrl && <button type="button" onClick={() => change("imageUrl", "")}>Quitar foto</button>}
                </div>
                {libraryOpen && <div className="library-inline"><Suspense fallback={<p role="status">Cargando fotos…</p>}><Library onBusyChange={setLibraryBusy} onSelect={url => { change("imageUrl", url); setLibraryOpen(false); }} /></Suspense></div>}
              </fieldset>

              {failure && <p className="form-error" role="alert">{failure}</p>}
              <div className="dialog-actions">
                <button type="button" onClick={async () => { if (await leave()) setForm(null); }}>Cancelar</button>
                <button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Guardar campaña"}</button>
              </div>
            </fieldset>
          </form>
          <aside className="campaign-preview-wrap">
            <span className="kicker">Vista previa</span>
            <Preview form={form} products={selection} />
            <p>{selection.length} {selection.length === 1 ? "producto" : "productos"} con existencias en la selección. Los precios y existencias se toman del catálogo al mostrarla.</p>
          </aside>
        </article>
      )}

      <div className="campaign-list">
        {rows.map(row => (
          <article key={row.id} className={`campaign-row status-${row.status.toLowerCase()}`}>
            <span className={`campaign-swatch theme-${row.theme.toLowerCase()}`} aria-hidden="true" />
            <div>
              <b>{row.title}</b>
              <span>{row.eyebrow} · {shortDate(row.startsOn)} – {shortDate(row.endsOn)} · prioridad {row.priority}</span>
              <small>{[row.goals.length && `${row.goals.length} objetivo${row.goals.length > 1 ? "s" : ""}`, row.brands.length && `${row.brands.length} marca${row.brands.length > 1 ? "s" : ""}`, row.productIds.length && `${row.productIds.length} elegido${row.productIds.length > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}{row.suggested ? " · sugerida" : ""}</small>
            </div>
            <em className={`campaign-status status-${row.status.toLowerCase()}`}>{statusLabels[row.status]}</em>
            <div className="row-actions">
              {row.status === "LIVE" && <a href={`${webUrl}/campana/${row.slug}`} target="_blank" rel="noopener noreferrer"><ExternalLink />Ver en tienda</a>}
              <button onClick={() => void open(row)}>Editar</button>
              <button onClick={() => void setActive(row)} disabled={busy}>{row.active ? <><Pause />Pausar</> : <><Play />Activar</>}</button>
              <button className="danger" onClick={() => void destroy(row)} disabled={busy}><Trash2 />Eliminar</button>
            </div>
          </article>
        ))}
        {!list.loading && !rows.length && <div className="empty-state">Aún no hay campañas. Crea la primera para destacar una temporada o una selección de productos.</div>}
      </div>
    </section>
  );
}
