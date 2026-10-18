// ROT-01 (M30): antigüedad de la mercadería por recepción y productos con poca salida. La regla vive en el
// servidor; esta vista solo la muestra, con texto además de color y tarjetas legibles en el teléfono.
import { gql, useQuery } from "@apollo/client";
import { useMemo, useState } from "react";
import { formatMoney } from "@vital-forge/ui-core";
import { ExchangeForm, ExchangeList } from "./Exchanges";

export const INVENTORY_AGING = gql`query InventoryAging { inventoryAging }`;
export type AgingLayer = { productId: string; sku: string; title: string; warehouseId: string; layerId: string; lot: string; expiresOn: string; receivedOn: string; ageDays: number | null; targetOn: string | null; daysToTarget: number | null; status: string; onHand: number; reserved: number; available: number; unitCost: number | null; costValue: number | null; leftoverAtTarget: number | null; expiresBeforeTarget: boolean; purchaseId?: string; supplierId?: string; supplierName?: string };
type Slow = { productId: string; sku: string; title: string; onHand: number; unitsSold: number; daysWithStock: number; dailyVelocity: number | null; reason: string | null; leftoverAtTarget: number | null; oldestReceivedOn: string | null; costValue: number | null; costComplete: boolean };
export type Aging = { config: { targetMonths: number; prepareDays: number; priorityDays: number; windowDays: number; minHistoryDays: number }; today: string; layers: AgingLayer[]; slow: Slow[]; insufficientHistory: number; summary: { byStatus: Record<string, { layers: number; units: number }>; toManage: { products: number; units: number; costValue: number; costComplete: boolean; nextTargetOn: string | null }; expiresBeforeTarget: number } };
export const statusText: Record<string, { label: string; action: string; mark: string }> = {
  OBJETIVO_ALCANZADO: { label: "Objetivo alcanzado", action: "Gestionar cambio prioritario", mark: "●●●" },
  PRIORITARIO: { label: "Prioritario", action: "Contactar proveedor", mark: "●●○" },
  PREPARAR: { label: "Preparar gestión", action: "Revisar salida o cambio", mark: "●○○" },
  EN_PLAZO: { label: "En plazo", action: "Sin acción", mark: "○○○" },
  SIN_FECHA: { label: "Sin fecha de recepción", action: "Saldo anterior al registro de recepciones", mark: "—" }
};
const date = (iso: string | null) => iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const age = (days: number | null) => days === null ? "Desconocida" : days < 60 ? `${days} días` : `${(days / 30.44).toFixed(1).replace(".", ",")} meses`;

export function AgingSummary({ data, onOpen }: { data: Aging; onOpen?: () => void }) {
  const m = data.summary.toManage;
  return <article className="report-card aging-summary" aria-labelledby="aging-summary-title">
    <div className="card-title"><h2 id="aging-summary-title">Mercadería por cambiar</h2>{onOpen && <button type="button" onClick={onOpen}>Ver detalle</button>}</div>
    {m.units ? <p><b>{m.units} unidades</b> de {m.products} {m.products === 1 ? "producto" : "productos"} se acercan o pasaron el objetivo de {data.config.targetMonths} meses. Valor a costo con IVA: <b>{formatMoney(m.costValue)}</b>{m.costComplete ? "" : " (parcial: hay costos sin registrar)"}. Próxima gestión: {date(m.nextTargetOn)}.</p> : <p>Ninguna recepción está cerca del objetivo de {data.config.targetMonths} meses.</p>}
    <ul className="aging-counts">{(["OBJETIVO_ALCANZADO", "PRIORITARIO", "PREPARAR", "EN_PLAZO", "SIN_FECHA"] as const).map(s => <li key={s} className={`aging-${s}`}><span aria-hidden="true">{statusText[s]!.mark}</span> {statusText[s]!.label}: <b>{data.summary.byStatus[s]?.units ?? 0}</b> u.</li>)}</ul>
    {!!data.slow.length && <p>{data.slow.length} {data.slow.length === 1 ? "producto tiene" : "productos tienen"} poca salida.</p>}
  </article>;
}

export function AgingPanel({ warehouseName, suppliers = [], purchases = [], readonly = true }: { warehouseName: (id: string) => string; suppliers?: Array<{ id: string; name: string; active: boolean }>; purchases?: Array<{ id: string; number: string; supplierId: string; status: string; total: number }>; readonly?: boolean }) {
  const [preparing, setPreparing] = useState<AgingLayer | null>(null); const [notice, setNotice] = useState("");
  const onPrepareChange = readonly ? undefined : (layer: AgingLayer) => { setNotice(""); setPreparing(layer); requestAnimationFrame(() => document.getElementById("exchange-title")?.focus()); };
  const query = useQuery<{ inventoryAging: Aging }>(INVENTORY_AGING, { fetchPolicy: "network-only" });
  const [status, setStatus] = useState("ALERTAS"); const [supplier, setSupplier] = useState(""); const [term, setTerm] = useState("");
  const data = query.data?.inventoryAging;
  const supplierFilter = useMemo(() => [...new Map((data?.layers ?? []).filter(l => l.supplierId).map(l => [l.supplierId!, l.supplierName ?? ""])).entries()], [data]);
  if (query.loading && !data) return <p role="status">Calculando antigüedad…</p>;
  if (query.error || !data) return <p role="alert">{query.error?.message ?? "No se pudo calcular la antigüedad."}</p>;
  const rows = data.layers.filter(l => (status === "TODAS" || (status === "ALERTAS" ? ["OBJETIVO_ALCANZADO", "PRIORITARIO", "PREPARAR"].includes(l.status) : l.status === status)) && (!supplier || l.supplierId === supplier) && `${l.title} ${l.sku} ${l.lot}`.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
  const c = data.config;
  return <div className="aging-panel">
    {notice && <p role="status" className="admin-success">{notice}</p>}
    {preparing && <ExchangeForm key={preparing.layerId + preparing.warehouseId} layer={preparing} suppliers={suppliers} onCancel={() => setPreparing(null)} onDone={message => { setPreparing(null); setNotice(message); }} />}
    <AgingSummary data={data} />
    <p className="aging-rule">Objetivo interno: {c.targetMonths} meses desde la recepción real; aviso a {c.prepareDays} y {c.priorityDays} días. La poca salida usa la venta de los últimos {c.windowDays} días con stock. No es una caducidad ni un plazo del proveedor. Los valores se ajustan en Configuración.</p>
    <div className="fields three">
      <label>Estado<select value={status} onChange={e => setStatus(e.target.value)}><option value="ALERTAS">Con aviso</option><option value="TODAS">Todas las recepciones</option>{Object.entries(statusText).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
      <label>Proveedor<select value={supplier} onChange={e => setSupplier(e.target.value)}><option value="">Todos</option>{supplierFilter.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Buscar<input value={term} onChange={e => setTerm(e.target.value)} placeholder="Producto, SKU o lote" /></label>
    </div>
    <h2>Recepciones en inventario</h2>
    {!rows.length && <p className="empty-state">No hay recepciones con este filtro.</p>}
    <ul className="aging-list">{rows.map(l => <li key={`${l.layerId}:${l.warehouseId}`} className={`aging-${l.status}`}>
      <div><b>{l.title}</b><small>{l.sku} · {warehouseName(l.warehouseId)} · lote {l.lot}{l.supplierName ? ` · ${l.supplierName}` : ""}</small></div>
      <p className="aging-status"><span aria-hidden="true">{statusText[l.status]?.mark}</span> <b>{statusText[l.status]?.label}</b>{l.daysToTarget !== null ? ` · ${l.daysToTarget > 0 ? `faltan ${l.daysToTarget} días` : `${-l.daysToTarget} días sobre el objetivo`}` : ""} · {statusText[l.status]?.action}</p>
      <dl><div><dt>Recibido</dt><dd>{date(l.receivedOn || null)}</dd></div><div><dt>Antigüedad</dt><dd>{age(l.ageDays)}</dd></div><div><dt>Objetivo</dt><dd>{date(l.targetOn)}</dd></div><div><dt>Unidades</dt><dd>{l.onHand}{l.reserved ? ` (${l.reserved} reservadas)` : ""}</dd></div><div><dt>Costo con IVA</dt><dd>{l.costValue === null ? "Sin registrar" : formatMoney(l.costValue)}</dd></div><div><dt>Sobrarán al objetivo</dt><dd>{l.leftoverAtTarget === null ? "Sin historial suficiente" : l.leftoverAtTarget}</dd></div></dl>
      {l.expiresBeforeTarget && <p className="notice">El vencimiento del envase ({date(l.expiresOn)}) llega antes del objetivo: prioriza esta salida.</p>}
      {onPrepareChange && l.available > 0 && l.receivedOn && <button type="button" onClick={() => onPrepareChange(l)}>Preparar cambio</button>}
    </li>)}</ul>
    <h2>Productos con poca salida</h2>
    <p>{data.insufficientHistory ? `${data.insufficientHistory} productos tienen menos de ${c.minHistoryDays} días de historial con stock: aún no se calcula su salida.` : "Todos los productos con stock tienen historial suficiente."}</p>
    {!data.slow.length ? <p className="empty-state">Ningún producto con historial suficiente muestra poca salida.</p> : <ul className="aging-list">{data.slow.map(s => <li key={`${s.productId}:${s.sku}`}>
      <div><b>{s.title}</b><small>{s.sku}</small></div>
      <p className="aging-status"><b>{s.reason === "SIN_VENTAS" ? "Sin ventas en el período con stock disponible" : `Sobrarán unas ${s.leftoverAtTarget} unidades al llegar al objetivo`}</b></p>
      <dl><div><dt>En inventario</dt><dd>{s.onHand}</dd></div><div><dt>Vendidas</dt><dd>{s.unitsSold} en {s.daysWithStock} días con stock</dd></div><div><dt>Ritmo</dt><dd>{s.dailyVelocity === null ? "—" : `${(s.dailyVelocity * 30).toFixed(1).replace(".", ",")} u. al mes`}</dd></div><div><dt>Costo con IVA</dt><dd>{formatMoney(s.costValue ?? 0)}{s.costComplete ? "" : " (parcial)"}</dd></div></dl>
    </li>)}</ul>}
    <ExchangeList purchases={purchases} readonly={readonly} />
  </div>;
}
