import { useMutation, useQuery } from "@apollo/client";
import { useRef, useState } from "react";
import { BellRing } from "lucide-react";
import { NOTIFICATION_OUTBOX, RETRY_FAILED_NOTIFICATIONS, type NotificationOutboxSummary } from "@vital-forge/shared-logic";
import "./commerce.css";

/** Avisos de pedido (correo y Telegram) que el servidor guarda y reintenta solo. */
export function NotificationsPanel() {
  const query = useQuery<{ notificationOutbox: NotificationOutboxSummary }>(NOTIFICATION_OUTBOX, { fetchPolicy: "network-only", pollInterval: 30_000 });
  const [retry] = useMutation<{ retryFailedNotifications: number }>(RETRY_FAILED_NOTIFICATIONS);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const running = useRef(false);
  const summary = query.data?.notificationOutbox;

  const retryFailed = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setMessage("");
    try {
      const { data } = await retry();
      setMessage(`${data?.retryFailedNotifications ?? 0} aviso(s) volverán a intentarse en menos de un minuto.`);
      await query.refetch();
    } catch { setMessage("No se pudo pedir el reintento. Vuelve a intentarlo."); }
    finally { running.current = false; setBusy(false); }
  };

  return (
    <section className="commerce-panel notifications-panel" aria-labelledby="notifications-title">
      <header>
        <h2 id="notifications-title"><BellRing size={18} aria-hidden="true" /> Avisos de pedidos</h2>
        <p>Correos al cliente y avisos al operador por correo y Telegram. Si un canal falla, el servidor reintenta solo durante unas 4 horas; si no lo logra, aparece aquí.</p>
      </header>
      {!summary ? <p role="status">{query.error ? "No se pudo leer el estado de los avisos." : "Cargando avisos…"}</p> : (
        <>
          <p className={summary.failed ? "form-error" : "commerce-hint"} role={summary.failed ? "alert" : "status"}>
            {summary.failed ? `${summary.failed} aviso(s) no se pudieron enviar. Revisa la configuración del canal y reintenta.`
              : summary.pending ? `${summary.pending} aviso(s) en cola; se envían o reintentan automáticamente.`
              : "Sin avisos pendientes ni fallidos."}
          </p>
          {summary.failures.length > 0 && (
            <ul className="notification-failures">
              {summary.failures.map(item => (
                <li key={item.id}><b>{item.label}</b><small>{item.attempts} intentos · {new Date(item.createdAt).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" })}{item.lastError ? ` · ${item.lastError}` : ""}</small></li>
              ))}
            </ul>
          )}
          {message && <p className="admin-success" role="status">{message}</p>}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={() => void query.refetch()}>Actualizar</button>
            <button type="button" className="primary-button" disabled={busy || !summary.failed} onClick={() => void retryFailed()}>{busy ? "Pidiendo reintento…" : "Reintentar fallidos"}</button>
          </div>
        </>
      )}
    </section>
  );
}
