// CMB-01: preparar y seguir cambios con el proveedor. Generar descuenta en ese momento (decisión del
// propietario); el resto —reposición, diferencia de valor y cierre— se registra después, con pocos campos.
import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { useState } from "react";
import { formatMoney } from "@vital-forge/ui-core";
import { useConfirm } from "../../components/common/ConfirmDialog";
import { ProductPicker } from "./InvoiceImport";
import type { AgingLayer } from "./AgingPanel";

const EXCHANGES = gql`query SupplierExchanges { supplierExchanges }`;
const GENERATE = gql`mutation GenerateExchange($input:JSON!,$key:String!){generateExchange(input:$input,idempotencyKey:$key)}`;
const LINK = gql`mutation LinkExchange($id:ID!,$revision:Int!,$purchaseId:ID!){linkExchangeReplacement(id:$id,revision:$revision,purchaseId:$purchaseId)}`;
const CLOSE = gql`mutation CloseExchange($id:ID!,$revision:Int!,$note:String!){closeExchange(id:$id,revision:$revision,note:$note)}`;
const VOID = gql`mutation VoidExchange($id:ID!,$revision:Int!,$reason:String!){voidExchange(id:$id,revision:$revision,reason:$reason)}`;
type Supplier = { id: string; name: string; active: boolean };
type Purchase = { id: string; number: string; supplierId: string; status: string; total: number };
type Exchange = { id: string; number: string; supplierId: string; supplierName: string; status: string; revision: number; createdAt: string; items: Array<{ title: string; sku: string; quantity: number }>; replacement: { title: string; quantity?: number }; valueOut: number | null; valueIn: number; difference: number | null; replacements: Array<{ purchaseId: string; number: string; value: number }>; closingNote?: string; voidReason?: string };
const statusLabel: Record<string, string> = { ABIERTO: "Enviado, pendiente de reposición", REPUESTO: "Reposición vinculada", CERRADO: "Cerrado", CERRADO_CON_DIFERENCIA: "Cerrado con diferencia", ANULADO: "Anulado: unidades devueltas al inventario" };
const errorText = (e: unknown) => e instanceof Error ? e.message : "No se pudo guardar.";

export function ExchangeForm({ layer, suppliers, onDone, onCancel }: { layer: AgingLayer; suppliers: Supplier[]; onDone: (message: string) => void; onCancel: () => void }) {
  const client = useApolloClient(), confirm = useConfirm();
  const [key] = useState(() => crypto.randomUUID());
  const [quantity, setQuantity] = useState(layer.available); const [supplierId, setSupplierId] = useState(layer.supplierId ?? "");
  const [sealed, setSealed] = useState(false); const [replacement, setReplacement] = useState<{ productId: string; sku: string; title: string } | null>(null);
  const [note, setNote] = useState(""); const [picking, setPicking] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [generate] = useMutation(GENERATE);
  const value = layer.unitCost === null ? null : Math.round(layer.unitCost * quantity * 100) / 100;
  const valid = sealed && supplierId && quantity >= 1 && quantity <= layer.available;
  const submit = async () => {
    if (!valid || busy) return;
    if (!await confirm({ title: "Generar cambio", message: `Se descontarán ahora ${quantity} unidades de ${layer.title} del inventario y quedarán pendientes de reposición${value !== null ? ` por ${formatMoney(value)} a costo con IVA` : ""}. El reemplazo entrará después con su factura.`, confirmLabel: "Generar cambio" })) return;
    setBusy(true); setError("");
    try {
      const result = (await generate({ variables: { key, input: { supplierId, sealedConfirmed: true, lines: [{ productId: layer.productId, sku: layer.sku, warehouseId: layer.warehouseId, layerId: layer.layerId, quantity }], replacement: replacement ? { productId: replacement.productId, sku: replacement.sku, note } : { note }, notes: "" } } })).data?.generateExchange as { number: string };
      await client.refetchQueries({ include: "active" }).catch(() => undefined);
      onDone(`Cambio ${result.number} generado: ${quantity} unidades salieron del inventario.`);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <form className="report-card exchange-form" aria-labelledby="exchange-title" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <h2 id="exchange-title">Preparar cambio · {layer.title}</h2>
    <p>{layer.sku} · lote {layer.lot} · recibido {layer.receivedOn} · {layer.available} unidades sin reservar{layer.reserved ? ` (${layer.reserved} reservadas para pedidos no se envían)` : ""}.</p>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="fields two">
        <label>Unidades que se envían<input type="number" required min={1} max={layer.available} value={quantity} onChange={e => setQuantity(Math.round(Number(e.target.value)))} /></label>
        <label>Proveedor<select required value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">Selecciona el proveedor</option>{suppliers.filter(s => s.active || s.id === supplierId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      </div>
      <label className="checkbox-label"><input type="checkbox" checked={sealed} onChange={e => setSealed(e.target.checked)} />Confirmo que estas unidades están selladas</label>
      <div className="exchange-replacement"><span>Reemplazo: <b>{replacement ? replacement.title : "Por acordar"}</b></span><button type="button" onClick={() => setPicking(true)}>{replacement ? "Cambiar producto" : "Elegir producto"}</button>{replacement && <button type="button" onClick={() => setReplacement(null)}>Dejar por acordar</button>}</div>
      {picking && <ProductPicker initial="" onCancel={() => setPicking(false)} onPick={p => { setReplacement(p); setPicking(false); }} />}
      <div className="fields two"><label>Nota para el proveedor (opcional)<input maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder="Por ejemplo: cambiar por la presentación de 2 lb" /></label></div>
      <p role="status">{valid ? `Saldrán ${quantity} unidades al confirmar${value !== null ? ` · ${formatMoney(value)} a costo con IVA` : " · costo sin registrar"}. No cuenta como venta ni pérdida.` : "Indica unidades, proveedor y confirma el sellado."}</p>
      {error && <p role="alert" className="notice-error">{error}</p>}
      <div className="dialog-actions"><button type="button" onClick={onCancel}>Cancelar</button><button className="primary-button" disabled={!valid || busy}>Generar cambio</button></div>
    </fieldset>
  </form>;
}

export function ExchangeList({ purchases, readonly }: { purchases: Purchase[]; readonly: boolean }) {
  const client = useApolloClient();
  const query = useQuery<{ supplierExchanges: { exchanges: Exchange[]; pending: { exchanges: number; units: number; pendingValue: number; complete: boolean } } }>(EXCHANGES, { fetchPolicy: "network-only" });
  const [link] = useMutation(LINK), [close] = useMutation(CLOSE), [cancel] = useMutation(VOID);
  const [open, setOpen] = useState<{ id: string; mode: "link" | "close" | "void"; value: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const data = query.data?.supplierExchanges;
  const run = async (work: () => Promise<unknown>, success: string) => { setBusy(true); setError(""); setMessage(""); try { await work(); setOpen(null); setMessage(success); await client.refetchQueries({ include: "active" }).catch(() => undefined); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  if (!data) return query.error ? <p role="alert">{query.error.message}</p> : <p role="status">Cargando cambios…</p>;
  return <section aria-labelledby="exchanges-title" className="exchange-list">
    <h2 id="exchanges-title">Cambios con proveedores</h2>
    <p>{data.pending.exchanges ? `Pendiente de reposición: ${formatMoney(data.pending.pendingValue)}${data.pending.complete ? "" : " (parcial)"} en ${data.pending.exchanges} ${data.pending.exchanges === 1 ? "cambio" : "cambios"}, ${data.pending.units} unidades.` : "No hay cambios pendientes."}</p>
    {message && <p role="status" className="admin-success">{message}</p>}{error && <p role="alert" className="notice-error">{error}</p>}
    {!!data.exchanges.length && <ul className="aging-list">{data.exchanges.map(x => <li key={x.id}>
      <div><b>{x.number} · {x.supplierName}</b><small>{statusLabel[x.status] ?? x.status} · {new Date(x.createdAt).toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" })}</small></div>
      <p>{x.items.map(i => `${i.quantity} × ${i.title}`).join(", ")} · reemplazo: {x.replacement.title}</p>
      <dl><div><dt>Salió</dt><dd>{x.valueOut === null ? "Costo sin registrar" : formatMoney(x.valueOut)}</dd></div><div><dt>Repuesto</dt><dd>{formatMoney(x.valueIn)}{x.replacements.length ? ` (${x.replacements.map(r => r.number).join(", ")})` : ""}</dd></div><div><dt>Diferencia</dt><dd>{x.difference === null ? "—" : formatMoney(x.difference)}</dd></div></dl>
      {x.closingNote && <p>Cierre: {x.closingNote}</p>}{x.voidReason && <p>Motivo: {x.voidReason}</p>}
      {!readonly && ["ABIERTO", "REPUESTO"].includes(x.status) && <div className="row-actions"><button type="button" onClick={() => setOpen({ id: x.id, mode: "link", value: "" })}>Vincular compra de reposición</button><button type="button" onClick={() => setOpen({ id: x.id, mode: "close", value: "" })}>Cerrar</button>{x.status === "ABIERTO" && <button type="button" onClick={() => setOpen({ id: x.id, mode: "void", value: "" })}>Anular: el proveedor lo rechazó</button>}</div>}
      {open?.id === x.id && <form className="exchange-action" onSubmit={e => { e.preventDefault(); const v = open.value; void run(() => open.mode === "link" ? link({ variables: { id: x.id, revision: x.revision, purchaseId: v } }) : open.mode === "close" ? close({ variables: { id: x.id, revision: x.revision, note: v } }) : cancel({ variables: { id: x.id, revision: x.revision, reason: v } }), open.mode === "link" ? "Reposición vinculada." : open.mode === "close" ? "Cambio cerrado." : "Cambio anulado: las unidades volvieron a su recepción."); }}>
        {open.mode === "link" ? <label>Compra de reposición<select required value={open.value} onChange={e => setOpen({ ...open, value: e.target.value })}><option value="">Selecciona la compra</option>{purchases.filter(p => p.supplierId === x.supplierId && p.status !== "CANCELLED" && !x.replacements.some(r => r.purchaseId === p.id)).map(p => <option key={p.id} value={p.id}>{p.number} · {formatMoney(p.total)}</option>)}</select></label>
          : <label>{open.mode === "close" ? (x.difference !== null && Math.abs(x.difference) < 0.01 ? "Nota de cierre (opcional)" : "Cómo se resolvió la diferencia") : "Motivo del rechazo"}<input value={open.value} maxLength={300} onChange={e => setOpen({ ...open, value: e.target.value })} /></label>}
        <div className="dialog-actions"><button type="button" onClick={() => setOpen(null)}>Cancelar</button><button className="primary-button" disabled={busy}>Confirmar</button></div>
      </form>}
    </li>)}</ul>}
  </section>;
}
