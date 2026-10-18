import { gql, useMutation, useQuery } from "@apollo/client";
import { useState } from "react";
import { formatMoney } from "@vital-forge/ui-core";
import { useConfirm } from "./common/ConfirmDialog";

// CU12: bandeja de solicitudes de cancelación de clientes. Aprobar cancela el pedido en la misma transacción
// (stock, descuento, historial y avisos); rechazar exige un motivo que verá el cliente. La nota interna no se publica.
const LIST = gql`query CancellationRequests($status:String){cancellationRequests(status:$status){id orderNumber status reasonLabel note createdAt revision order{status paymentMethod total paidAt customerName}}}`;
const RESOLVE = gql`mutation ResolveCancellationRequest($id:ID!,$revision:Int!,$approve:Boolean!,$publicNote:String!,$internalNote:String){resolveCancellationRequest(id:$id,revision:$revision,approve:$approve,publicNote:$publicNote,internalNote:$internalNote){id status revision}}`;
type Request = { id: string; orderNumber: string; status: string; reasonLabel: string; note: string; createdAt: string; revision: number; order: { status: string; paymentMethod: string; total: number; paidAt: string | null; customerName: string } | null };
const statusLabels: Record<string, string> = { PENDING_PAYMENT: "Pendiente de pago", PAYMENT_REVIEW: "Pago por confirmar", PAID: "Pagado", PREPARING: "En preparación", SHIPPED: "Enviado", COMPLETED: "Completado", CANCELLED: "Cancelado", RETURNED: "Devuelto" };

export function CancellationRequests() {
  const confirm = useConfirm();
  const { data, loading, error, refetch } = useQuery<{ cancellationRequests: Request[] }>(LIST, { variables: { status: "PENDING" }, fetchPolicy: "cache-and-network" });
  const [resolve] = useMutation(RESOLVE);
  const [notes, setNotes] = useState<Record<string, { publicNote: string; internalNote: string }>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const requests = data?.cancellationRequests ?? [];
  // Sin solicitudes no se muestra, salvo para confirmar la última decisión (si no, el mensaje desaparecería con ella).
  if (!loading && !error && !requests.length && !message) return null;

  const decide = async (request: Request, approve: boolean) => {
    const note = notes[request.id] ?? { publicNote: "", internalNote: "" };
    if (!approve && note.publicNote.trim().length < 5) { setMessage({ ok: false, text: `Escribe al cliente el motivo del rechazo del pedido ${request.orderNumber}.` }); document.getElementById(`public-${request.id}`)?.focus(); return; }
    const ok = await confirm(approve
      ? { title: `Cancelar el pedido ${request.orderNumber}`, message: `Se cancelará el pedido, se liberará su stock y se avisará al cliente.${request.order?.paidAt ? " Hubo pago: registra después el reembolso en «Seguimiento y devoluciones»." : ""}`, confirmLabel: "Aprobar y cancelar", danger: true }
      : { title: `Rechazar la solicitud de ${request.orderNumber}`, message: "El pedido sigue igual y el cliente verá tu motivo.", confirmLabel: "Rechazar solicitud" });
    if (!ok) return;
    setBusy(request.id); setMessage(null);
    try {
      await resolve({ variables: { id: request.id, revision: request.revision, approve, publicNote: note.publicNote.trim(), internalNote: note.internalNote.trim() } });
      setMessage({ ok: true, text: approve ? `Pedido ${request.orderNumber} cancelado.` : `Solicitud de ${request.orderNumber} rechazada.` });
    } catch (caught) { setMessage({ ok: false, text: caught instanceof Error ? caught.message : "No se pudo resolver la solicitud." }); }
    finally { setBusy(""); void refetch(); }
  };
  const set = (id: string, key: "publicNote" | "internalNote", value: string) => setNotes(current => ({ ...current, [id]: { publicNote: "", internalNote: "", ...current[id], [key]: value } }));

  return (
    <section className="report-card cancellation-requests" aria-labelledby="cancellation-requests-title">
      <h2 id="cancellation-requests-title">Solicitudes de cancelación {requests.length ? `(${requests.length})` : ""}</h2>
      {loading && !data && <p role="status">Cargando solicitudes…</p>}
      {error && <p role="alert">{error.message}</p>}
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "admin-success" : "notice-error"}>{message.text}</p>}
      {!requests.length && !loading && <p>No quedan solicitudes pendientes.</p>}
      {requests.map(request => (
        <article key={request.id} className="order-card">
          <header><div><b>{request.orderNumber}</b><span>{request.order?.customerName} · {new Date(request.createdAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}</span></div><strong>{request.order ? formatMoney(request.order.total) : ""}</strong></header>
          <p>Motivo: {request.reasonLabel}{request.note && ` · «${request.note}»`}</p>
          {request.order && <small>Estado: {statusLabels[request.order.status] ?? request.order.status} · {request.order.paymentMethod === "CASH_ON_DELIVERY" ? "Contra entrega" : "Transferencia"}{request.order.paidAt ? " · hubo pago: corresponde reembolso" : ""}</small>}
          <label>Mensaje para el cliente{request.order?.status === "SHIPPED" ? " (el pedido ya salió: recházala con el motivo)" : ""}<input id={`public-${request.id}`} maxLength={300} value={notes[request.id]?.publicNote ?? ""} onChange={event => set(request.id, "publicNote", event.target.value)} placeholder="Obligatorio para rechazar" /></label>
          <label>Nota interna (opcional)<input maxLength={500} value={notes[request.id]?.internalNote ?? ""} onChange={event => set(request.id, "internalNote", event.target.value)} /></label>
          <div className="row-actions">
            <button className="danger-button" disabled={busy === request.id} onClick={() => void decide(request, true)}>Aprobar y cancelar</button>
            <button disabled={busy === request.id} onClick={() => void decide(request, false)}>Rechazar</button>
          </div>
        </article>
      ))}
    </section>
  );
}
