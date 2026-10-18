// RES-01 (M18): cuánto se vendió y ganó de cada compra recibida. Margen bruto realizado, sin gastos ni fletes.
import { gql, useQuery } from "@apollo/client";
import { formatMoney } from "@vital-forge/ui-core";

const RESULTS = gql`query PurchaseResults { purchaseResults }`;
type Row = { purchaseId: string; number: string; supplierName: string; receivedOn: string | null; documentNumber: string | null; unitsReceived: number; purchaseTotal: number; unitsSold: number; unitsReturned: number; unitsExchanged: number; unitsRemaining: number; revenue: number; costSold: number | null; grossProfit: number | null; remainingCostValue: number | null; recoveredPercent: number | null };

export function PurchaseResults() {
  const query = useQuery<{ purchaseResults: { purchases: Row[]; unattributed: { units: number; revenue: number } } }>(RESULTS, { fetchPolicy: "cache-and-network" });
  const data = query.data?.purchaseResults;
  return <article className="biz-card purchase-results" aria-labelledby="purchase-results-title">
    <div className="biz-card-heading"><div><span className="kicker">ORIGEN DE LAS VENTAS</span><h2 id="purchase-results-title">Resultados por compra</h2></div></div>
    <p>Margen bruto realizado de las unidades vendidas de cada compra, a costo histórico con IVA. No incluye gastos, fletes ni lo que aún queda en inventario.</p>
    {query.error && <p role="alert">{query.error.message}</p>}
    {!data ? <p role="status">Calculando…</p> : !data.purchases.length ? <p className="empty-state">Aún no hay compras recibidas con el registro de origen.</p> :
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Compra</th><th>Unidades</th><th>Costo de la compra</th><th>Ingreso atribuido</th><th>Margen realizado</th><th>Queda a costo</th><th>Recuperado</th></tr></thead><tbody>{data.purchases.map(r => <tr key={r.purchaseId}>
        <td><b>{r.number}</b><small>{r.supplierName}{r.documentNumber ? ` · Factura ${r.documentNumber}` : ""}{r.receivedOn ? ` · ${r.receivedOn}` : ""}</small></td>
        <td>{r.unitsSold} de {r.unitsReceived} vendidas<small>{r.unitsRemaining} quedan{r.unitsReturned ? ` · ${r.unitsReturned} devueltas` : ""}{r.unitsExchanged ? ` · ${r.unitsExchanged} en cambio` : ""}</small></td>
        <td>{formatMoney(r.purchaseTotal)}</td><td>{formatMoney(r.revenue)}</td>
        <td>{r.grossProfit === null ? "Costo incompleto" : formatMoney(r.grossProfit)}</td>
        <td>{r.remainingCostValue === null ? "Costo incompleto" : formatMoney(r.remainingCostValue)}</td>
        <td>{r.recoveredPercent === null ? "—" : `${r.recoveredPercent.toLocaleString("es-EC")} %`}</td>
      </tr>)}</tbody></table></div>}
    {!!data?.unattributed.units && <p>{data.unattributed.units} unidades vendidas por {formatMoney(data.unattributed.revenue)} salieron de saldos anteriores al registro de compras: se muestran sin atribución.</p>}
  </article>;
}
