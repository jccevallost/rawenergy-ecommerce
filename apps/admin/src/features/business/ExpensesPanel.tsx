import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Plus, ReceiptText } from "lucide-react";
import { formatMoney } from "@vital-forge/ui-core";
import { usePanelFilter } from "../../lib/usePanelRoute";
import { useLeaveGuard, useUnsavedChanges } from "../../components/common/UnsavedChanges";
import { exportCsv } from "../../components/ManagementPanel";
import type { Section } from "../../components/layout/navigation";
import { expenseLabels, localToday, monthNames } from "./types";

const LIST = gql`query ExpenseLedger($filters: JSON!) { expenses(filters: $filters) }`;
const SAVE = gql`mutation SaveExpense($id: ID!, $input: JSON!, $revision: Int) { saveExpense(id: $id, input: $input, revision: $revision) }`;
const VOID = gql`mutation VoidExpense($id: ID!, $revision: Int!, $reason: String!) { voidExpense(id: $id, revision: $revision, reason: $reason) }`;
type Expense = { id: string; date: string; category: string; amount: number; description: string; reference: string; status: string; revision: number; createdByName: string; updatedByName: string; voidReason: string; updatedAt: string };
type Form = { id: string; revision?: number; date: string; category: string; amount: string; description: string; reference: string };
type Ledger = { rows: Expense[]; total: number; activeAmount: number; voidAmount: number };
export function ExpensesPanel({ readonly = false, onNavigate }: { readonly?: boolean; onNavigate: (section: Section, term?: string) => void }) {
  const today = localToday();
  const [year, setYear] = usePanelFilter("year", Number(today.slice(0, 4)));
  const [month, setMonth] = usePanelFilter("month", Number(today.slice(5, 7)));
  const [status, setStatus] = usePanelFilter("status", "ACTIVE");
  const [search, setSearch] = usePanelFilter("q", "");
  const [page, setPage] = usePanelFilter("page", 0);
  const [form, setForm] = useState<Form | null>(null), [baseline, setBaseline] = useState("");
  const [voiding, setVoiding] = useState<Expense | null>(null), [reason, setReason] = useState("");
  const [message, setMessage] = useState(""), [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false); const saving = useRef(false);
  const client = useApolloClient(), leave = useLeaveGuard();
  const [term, setTerm] = useState(search);
  useEffect(() => { const timeout = setTimeout(() => setTerm(search), 250); return () => clearTimeout(timeout); }, [search]);
  useUnsavedChanges(Boolean(form && JSON.stringify(form) !== baseline || voiding && reason), { busy });
  const query = useQuery<{ expenses: Ledger }>(LIST, { variables: { filters: { year, month, status, search: term, offset: page * 20, limit: 20 } }, fetchPolicy: "network-only", notifyOnNetworkStatusChange: true });
  const [save] = useMutation(SAVE), [voidExpense] = useMutation(VOID);
  const data = query.data?.expenses;
  const open = async (expense?: Expense) => {
    if (!await leave()) return;
    const next: Form = expense ? { id: expense.id, revision: expense.revision, date: expense.date, category: expense.category, amount: String(expense.amount), description: expense.description, reference: expense.reference } : { id: crypto.randomUUID(), date: today, category: "ADVERTISING", amount: "", description: "", reference: "" };
    setForm(next); setBaseline(JSON.stringify(next)); setVoiding(null); setReason(""); setMessage(""); setFailure("");
  };
  useEffect(() => { if (form || voiding) document.getElementById("expense-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [form?.id, voiding?.id]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setFailure(""); setMessage("");
    try {
      await action(); setForm(null); setVoiding(null); setReason(""); setMessage(success);
      await client.refetchQueries({ include: "active" }).catch(() => setFailure("El gasto se guardó. No se pudo actualizar la lista; vuelve a cargarla."));
    } catch (error) { setFailure(error instanceof Error ? error.message : "No se pudo guardar el gasto."); }
    finally { saving.current = false; setBusy(false); }
  };
  return <section className="admin-section business-dashboard expenses-panel"><div className="biz-header"><div><span className="kicker">GERENCIA · CONTROL DE GASTOS</span><h1>Gastos del negocio</h1><p>Publicidad, sueldos, transporte y otros gastos que afectan el resultado.</p></div><div className="biz-header-actions"><button onClick={() => onNavigate("management")}>Ver resultados <ArrowRight size={15}/></button>{!readonly && <button className="primary-button" disabled={busy} onClick={() => void open()}><Plus size={16}/>Registrar gasto</button>}</div></div>
    <div className="biz-empty-note"><ReceiptText size={23}/><p>Las compras de mercadería se registran en <b>Órdenes de compra</b>. Aquí registra los gastos del negocio para descontarlos una sola vez. No registres compras de productos nuevamente como gasto.</p></div>
    <div className="filter-bar"><label>Año<input type="number" min="2020" max="2100" value={year} onChange={e => { const v = Number(e.target.value); if (v >= 2020 && v <= 2100) { setYear(v); setPage(0); } }}/></label><label>Mes<select value={month} onChange={e => { setMonth(Number(e.target.value)); setPage(0); }}><option value={0}>Todo el año</option>{monthNames.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label><label>Estado<select value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="ACTIVE">Vigentes</option><option value="VOID">Anulados</option><option value="ALL">Todos</option></select></label><label>Buscar<input value={search} placeholder="Concepto o comprobante" onChange={e => { setSearch(e.target.value); setPage(0); }}/></label></div>
    {message && <p className="admin-success" role="status">{message}</p>}{(failure || query.error) && <div className="admin-alert" role="alert">{failure || query.error?.message}<button onClick={() => void query.refetch().catch(() => {})}>Actualizar lista</button></div>}{query.loading && <p role="status">Cargando gastos…</p>}
    {data && <div className="biz-ledger-summary"><div><span>Gastos vigentes del filtro</span><strong>{formatMoney(data.activeAmount)}</strong></div><div><span>Importe anulado del filtro</span><strong>{formatMoney(data.voidAmount)}</strong></div><div><span>Registros encontrados</span><strong>{data.total}</strong></div><button onClick={() => exportCsv("gastos-pagina.csv", [["Fecha", "Categoría", "Concepto", "Importe", "Referencia", "Estado", "Responsable", "Motivo anulación"], ...data.rows.map(e => [e.date, expenseLabels[e.category], e.description, e.amount, e.reference, e.status === "ACTIVE" ? "Vigente" : "Anulado", e.updatedByName, e.voidReason])])}>Exportar esta página</button></div>}
    {!readonly && (form || voiding) && <article className="biz-card expense-editor" id="expense-editor"><h2>{voiding ? "Anular gasto" : form?.revision === undefined ? "Registrar gasto" : "Corregir gasto"}</h2><form onSubmit={e => { e.preventDefault(); if (voiding) void run(() => voidExpense({ variables: { id: voiding.id, revision: voiding.revision, reason } }), "Gasto anulado. Se conserva en el historial y deja de descontarse del resultado."); else if (form) { const { id, revision, ...input } = form; void run(() => save({ variables: { id, revision, input: { ...input, amount: Number(input.amount) } } }), "Gasto guardado. El resultado del negocio ya contempla este importe."); } }}><fieldset disabled={busy}>
      {voiding ? <><p>{voiding.description} · <b>{formatMoney(voiding.amount)}</b></p><label>Motivo de anulación<textarea required minLength={5} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} placeholder="Explica por qué este gasto no corresponde…"/></label></> : form && <><div className="fields two"><label>Fecha del gasto<input type="date" required max={today} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}/></label><label>Categoría<select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{Object.entries(expenseLabels).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label><label>Importe en dólares<input type="number" min="0.01" max="1000000" step="0.01" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0.00"/></label><label>Referencia o comprobante (opcional)<input maxLength={120} value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="Ej. factura 001-123"/></label><label className="full">Concepto<textarea required minLength={5} maxLength={300} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Ej. publicidad en redes de septiembre"/></label></div>{form.category === "INVENTORY_LOSS" && <p className="biz-caption">Registra el costo de la pérdida y la referencia del lote. Si la mercancía ya salió de bodega, registra también el ajuste de existencias en Bodegas y lotes. Este gasto no cambia el stock.</p>}<p className="biz-caption">Se descuenta en el período de esta fecha. No transfiere dinero. El responsable y cada corrección quedan registrados.</p></>}
      <div className="dialog-actions"><button type="button" onClick={async () => { if (await leave()) { setForm(null); setVoiding(null); setReason(""); } }}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : voiding ? "Confirmar anulación" : "Guardar gasto"}</button></div></fieldset></form></article>}
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Fecha / categoría</th><th>Concepto</th><th>Importe</th><th>Responsable</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{data?.rows.map(e => <tr key={e.id}><td>{e.date}<small>{expenseLabels[e.category]}</small></td><td><b>{e.description}</b><small>{e.reference || "Sin referencia"}</small>{e.status === "VOID" && <small>Motivo: {e.voidReason}</small>}</td><td><b>{formatMoney(e.amount)}</b></td><td>{e.updatedByName}<small>{new Date(e.updatedAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}</small></td><td><span className={`status-pill ${e.status === "VOID" ? "status-CANCELLED" : "status-SUCCESS"}`}>{e.status === "VOID" ? "Anulado" : "Vigente"}</span></td><td><div className="row-actions"><button onClick={() => onNavigate("audit", e.id)}>Historial</button>{!readonly && e.status === "ACTIVE" && <><button disabled={busy} onClick={() => void open(e)}>Corregir</button><button disabled={busy} onClick={async () => { if (await leave()) { setForm(null); setVoiding(e); setReason(""); setFailure(""); } }}>Anular</button></>}</div></td></tr>)}</tbody></table></div>
    {!query.loading && data?.total === 0 && <div className="biz-empty"><ReceiptText/><h2>No hay gastos en este período</h2><p>Al registrarlos aparecerán aquí y se reflejarán en el dashboard.</p>{!readonly && <button onClick={() => void open()}>Registrar primer gasto</button>}</div>}
    <div className="pagination"><button disabled={!page || query.loading} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page + 1} · {data?.total ?? 0} gastos</span><button disabled={!data || (page + 1) * 20 >= data.total || query.loading} onClick={() => setPage(page + 1)}>Siguiente</button></div>
  </section>;
}
