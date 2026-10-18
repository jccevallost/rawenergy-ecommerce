// IMP-01: importar una factura en PDF, revisar solo lo necesario y registrar la compra en borrador.
// El servidor lee, concilia y decide; esta pantalla muestra excepciones y pide solo lo que el PDF no trae:
// producto del catálogo la primera vez, vencimiento del envase y, si se quiere, el lote del fabricante.
import { gql, useMutation, useQuery } from "@apollo/client";
import { useEffect, useRef, useState } from "react";
import { GET_ADMIN_PRODUCTS, type ProductConnection } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";

const GRAPHQL_URL = import.meta.env.VITE_GRAPHQL_URL ?? "http://localhost:4000/graphql";
const IMPORTS_URL = GRAPHQL_URL.replace(/\/graphql\/?$/, "") + "/purchase-imports";
const IMPORT = gql`query PurchaseImport($id:ID!){purchaseImport(id:$id)}`;
const IMPORTS = gql`query PurchaseImports{purchaseImports(limit:10)}`;
const APPROVE = gql`mutation ApproveImport($id:ID!,$revision:Int!,$input:JSON!){approvePurchaseImport(id:$id,revision:$revision,input:$input)}`;
const DISCARD = gql`mutation DiscardImport($id:ID!,$revision:Int!,$reason:String!){discardPurchaseImport(id:$id,revision:$revision,reason:$reason)}`;

type Line = { index: number; code: string; description: string; quantity: number; netUnitCost: string; netTotal: string; unitCost?: number; taxAllocated?: string; productId?: string; sku?: string; title?: string; aliasApproved?: boolean };
type Exception = { code: string; message: string; line?: number };
type Import = { id: string; status: string; failure?: string; revision: number; createdAt: string; supplier?: { taxId: string; name: string; supplierId?: string; supplierName?: string }; document?: { number: string; issuedOn: string; subtotal: string; tax: string; total: string }; lines: Line[]; exceptions: Exception[]; reconciliation?: { ok: boolean; message?: string; total?: number }; purchaseNumber?: string };
type Choice = { productId: string; sku: string; title: string; lot: string; expiresOn: string };
const statusLabel: Record<string, string> = { REQUIERE_REVISION: "Por revisar", LISTO: "Lista para registrar", REGISTRADO: "Registrada", FALLIDO: "No se pudo leer", DESCARTADO: "Descartada" };
const money = (value?: string | number) => formatMoney(Number(value ?? 0));
const todayEc = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);

export function InvoiceImport({ warehouses, suppliers, onClose, onRegistered }: { warehouses: Array<{ id: string; name: string; active: boolean }>; suppliers: Array<{ id: string; name: string; taxId?: string; active: boolean }>; onClose: () => void; onRegistered: (message: string) => void }) {
  const [id, setId] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [choices, setChoices] = useState<Record<number, Choice>>({}); const [picking, setPicking] = useState<number | null>(null);
  const [warehouseId, setWarehouseId] = useState("main"); const [supplierId, setSupplierId] = useState(""); const [discarding, setDiscarding] = useState(""); const [showDiscard, setShowDiscard] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null); const headingRef = useRef<HTMLHeadingElement>(null);
  const recent = useQuery<{ purchaseImports: Import[] }>(IMPORTS, { fetchPolicy: "network-only" });
  const current = useQuery<{ purchaseImport: Import | null }>(IMPORT, { variables: { id }, skip: !id, fetchPolicy: "network-only" });
  const [approve] = useMutation(APPROVE); const [discard] = useMutation(DISCARD);
  const record = current.data?.purchaseImport ?? null;

  // Las equivalencias aprobadas llegan ya elegidas: solo falta el vencimiento.
  useEffect(() => {
    if (!record) return;
    setChoices(Object.fromEntries(record.lines.filter(l => l.productId && l.sku).map(l => [l.index, { productId: l.productId!, sku: l.sku!, title: l.title ?? l.sku!, lot: "", expiresOn: "" }])));
    setSupplierId(record.supplier?.supplierId ?? "");
    requestAnimationFrame(() => headingRef.current?.focus());
  }, [record?.id, record?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (file: File) => {
    setError(""); setBusy(true);
    try {
      if (file.type && file.type !== "application/pdf") throw new Error("Elige el archivo PDF de la factura.");
      const response = await fetch(IMPORTS_URL, { method: "POST", headers: { "content-type": "application/pdf", authorization: `Bearer ${localStorage.getItem("rawenergy-token") ?? ""}` }, body: file });
      const body = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "No se pudo subir la factura.");
      setId(body.id); void recent.refetch();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo subir la factura."); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const viewPdf = async () => {
    const response = await fetch(`${IMPORTS_URL}/${encodeURIComponent(id)}/file`, { headers: { authorization: `Bearer ${localStorage.getItem("rawenergy-token") ?? ""}` } });
    if (!response.ok) { setError("No se pudo abrir el PDF."); return; }
    const url = URL.createObjectURL(await response.blob());
    // En el programa de Windows o la app puede no haber pestañas nuevas: entonces se descarga el PDF.
    if (!window.open(url, "_blank")) { const link = document.createElement("a"); link.href = url; link.download = `factura-${record?.document?.number ?? "importada"}.pdf`; link.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const lineExceptions = (index: number) => record?.exceptions.filter(e => e.line === index && e.code !== "SIN_EQUIVALENCIA") ?? [];
  const general = record?.exceptions.filter(e => e.line === undefined && e.code !== "PROVEEDOR_NUEVO") ?? [];
  const missing = record ? record.lines.filter(l => !choices[l.index]?.productId || !choices[l.index]?.expiresOn) : [];
  const canRegister = record && ["REQUIERE_REVISION", "LISTO"].includes(record.status) && record.reconciliation?.ok && !general.length && !missing.length;
  const register = async () => {
    if (!record || !canRegister) return;
    setBusy(true); setError("");
    try {
      const lines = record.lines.map(l => ({ index: l.index, productId: choices[l.index]!.productId, sku: choices[l.index]!.sku, lot: choices[l.index]!.lot.trim(), expiresOn: choices[l.index]!.expiresOn }));
      const result = (await approve({ variables: { id: record.id, revision: record.revision, input: { warehouseId, ...(supplierId ? { supplierId } : {}), lines } } })).data?.approvePurchaseImport as { purchaseNumber?: string };
      onRegistered(`Compra ${result.purchaseNumber ?? ""} creada en borrador con la factura ${record.document?.number}. El stock no cambió: confírmala y recíbela con la fecha real cuando cuentes la mercadería.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo registrar."); await current.refetch(); }
    finally { setBusy(false); }
  };

  return <section className="report-card invoice-import" aria-labelledby="import-title">
    <div className="section-heading"><h2 id="import-title" ref={headingRef} tabIndex={-1}>{record?.document ? `Factura ${record.document.number}` : "Importar factura en PDF"}</h2><button type="button" onClick={onClose}>Cerrar</button></div>
    {!record && <>
      <p>Sube el PDF de la factura electrónica. El sistema lee proveedor, líneas, IVA y total; tú solo eliges el producto la primera vez y escribes el vencimiento del envase. Nada cambia en el stock hasta recibir la compra.</p>
      <label className="file-drop">Factura en PDF<input ref={fileRef} type="file" accept="application/pdf,.pdf" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); }} /></label>
      {busy && <p role="status">Leyendo la factura…</p>}
      {!!recent.data?.purchaseImports.length && <><h3>Facturas recientes</h3><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Subida</th><th>Proveedor / factura</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{recent.data.purchaseImports.map(r => <tr key={r.id}><td>{new Date(r.createdAt).toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" })}</td><td>{r.supplier?.name ?? "Sin leer"}<small>{r.document?.number ?? r.failure}</small></td><td>{statusLabel[r.status] ?? r.status}{r.purchaseNumber ? ` · ${r.purchaseNumber}` : ""}</td><td><button type="button" onClick={() => setId(r.id)}>Abrir</button></td></tr>)}</tbody></table></div></>}
    </>}
    {error && <p role="alert" className="notice-error">{error}</p>}
    {record && <>
      <div className="import-summary">
        <p><b>{record.supplier?.name || "Proveedor sin leer"}</b> · RUC {record.supplier?.taxId || "—"} · Emisión {record.document?.issuedOn || "—"} · Estado: {statusLabel[record.status] ?? record.status}</p>
        {record.failure && <p role="alert">{record.failure}</p>}
        {record.reconciliation && <p className={record.reconciliation.ok ? "import-ok" : "notice-error"} role="status">{record.reconciliation.ok ? `Cuadra: subtotal ${money(record.document?.subtotal)} + IVA ${money(record.document?.tax)} = total ${money(record.document?.total)}.` : record.reconciliation.message}</p>}
        <button type="button" onClick={() => void viewPdf()}>Ver PDF</button>
      </div>
      {!!general.length && <div role="alert" className="import-exceptions"><b>Hay que resolver antes de registrar:</b><ul>{general.map((e, i) => <li key={i}>{e.message}</li>)}</ul></div>}
      {record.status === "REGISTRADO" && <p role="status">Ya se registró como compra {record.purchaseNumber}.</p>}
      {["REQUIERE_REVISION", "LISTO"].includes(record.status) && <>
        <div className="fields two">
          <label>Proveedor<select value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">{record.supplier?.supplierId ? record.supplier.supplierName : `Crear «${record.supplier?.name}» con RUC ${record.supplier?.taxId}`}</option>{suppliers.filter(s => s.active && s.id !== record.supplier?.supplierId && (!s.taxId || s.taxId === record.supplier?.taxId)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>Bodega de destino<select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>{warehouses.filter(w => w.active).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        </div>
        <p>{missing.length ? `Faltan ${missing.length} de ${record.lines.length} líneas por completar.` : "Todas las líneas están completas."} El vencimiento se toma del envase; el lote es opcional.</p>
        <ol className="import-lines">{record.lines.map(line => { const choice = choices[line.index]; return <li key={line.index} className={!choice?.productId || !choice?.expiresOn ? "needs-review" : ""}>
          <div><b>{line.description}</b><small>Código {line.code} · {line.quantity} u. · sin IVA {formatMoney(Number(line.netUnitCost))} · costo con IVA {line.unitCost !== undefined ? formatMoney(line.unitCost) : "—"}</small></div>
          {lineExceptions(line.index).map((e, i) => <p key={i} className="notice">{e.message}</p>)}
          <div className="fields three">
            <div className="import-product">{choice?.productId ? <><span>{choice.title}<small>{choice.sku}{line.aliasApproved && choice.productId === line.productId ? " · equivalencia aprobada" : ""}</small></span><button type="button" onClick={() => setPicking(line.index)}>Cambiar</button></> : <button type="button" className="primary-button" onClick={() => setPicking(line.index)}>Elegir producto</button>}</div>
            <label>Vencimiento del envase<input type="date" required min={todayEc()} value={choice?.expiresOn ?? ""} disabled={!choice} onChange={e => setChoices({ ...choices, [line.index]: { ...choice!, expiresOn: e.target.value } })} /></label>
            <label>Lote (opcional)<input maxLength={80} value={choice?.lot ?? ""} disabled={!choice} onChange={e => setChoices({ ...choices, [line.index]: { ...choice!, lot: e.target.value } })} /></label>
          </div>
          {picking === line.index && <ProductPicker initial={line.description.split(" ").slice(0, 2).join(" ")} onCancel={() => setPicking(null)} onPick={(p) => { setChoices({ ...choices, [line.index]: { lot: choice?.lot ?? "", expiresOn: choice?.expiresOn ?? "", ...p } }); setPicking(null); }} />}
        </li>; })}</ol>
        <div className="dialog-actions">
          {showDiscard ? <><label>Motivo para descartar<input minLength={5} maxLength={300} value={discarding} onChange={e => setDiscarding(e.target.value)} /></label><button type="button" disabled={busy || discarding.trim().length < 5} onClick={async () => { setBusy(true); try { await discard({ variables: { id: record.id, revision: record.revision, reason: discarding } }); setId(""); setShowDiscard(false); void recent.refetch(); } catch (c) { setError(c instanceof Error ? c.message : "No se pudo descartar."); } finally { setBusy(false); } }}>Confirmar descarte</button></> : <button type="button" onClick={() => setShowDiscard(true)}>Descartar</button>}
          <button type="button" className="primary-button" disabled={busy || !canRegister} onClick={() => void register()}>Registrar compra en borrador · {money(record.document?.total)}</button>
        </div>
      </>}
    </>}
  </section>;
}

export function ProductPicker({ initial, onPick, onCancel }: { initial: string; onPick: (choice: { productId: string; sku: string; title: string }) => void; onCancel: () => void }) {
  const [search, setSearch] = useState(initial); const [term, setTerm] = useState(initial);
  useEffect(() => { const t = setTimeout(() => setTerm(search), 300); return () => clearTimeout(t); }, [search]);
  const products = useQuery<{ searchProducts: ProductConnection }>(GET_ADMIN_PRODUCTS, { variables: { filters: { search: term, status: "ACTIVE" }, pagination: { first: 10 } } });
  const options = products.data?.searchProducts.edges.flatMap(({ node: p }) => p.variants.map(v => ({ productId: p.id, sku: v.sku, title: `${p.title} · ${v.flavor}` }))) ?? [];
  return <div className="import-picker">
    <label>Buscar en el catálogo<input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Nombre, marca o SKU" /></label>
    {products.loading && <p role="status">Buscando…</p>}
    <ul aria-label="Resultados">{options.map(o => <li key={`${o.productId}:${o.sku}`}><button type="button" onClick={() => onPick(o)}>{o.title}<small>{o.sku}</small></button></li>)}</ul>
    {!products.loading && !options.length && <p>Sin resultados. Prueba con otra palabra o crea el producto primero.</p>}
    <button type="button" onClick={onCancel}>Cancelar</button>
  </div>;
}
