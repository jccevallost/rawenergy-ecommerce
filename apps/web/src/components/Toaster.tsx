import { useEffect, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { useAnyModalLayer } from "../lib/modalLayers";
import { dismissToast, type Toast, useToasts } from "../lib/toast";

function ToastItem({ toast }: { toast: Toast }) {
  const [held, setHeld] = useState(false);
  // Se retira solo tras unos segundos, salvo mientras el puntero o el foco estén encima.
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => dismissToast(toast.id), 6000);
    return () => window.clearTimeout(timer);
  }, [held, toast.id]);
  return (
    <div className="toast" onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)} onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
      <CheckCircle2 size={20} aria-hidden="true" />
      <span>{toast.message}</span>
      {toast.action && <button type="button" className="btn btn-primary btn-sm" onClick={() => { dismissToast(toast.id); toast.action!.run(); }}>{toast.action.label}</button>}
      <button type="button" className="icon-btn icon-btn-dark icon-btn-sm" onClick={() => dismissToast(toast.id)} aria-label="Cerrar aviso"><X size={16} /></button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToasts();
  // Con un diálogo abierto (carrito, acceso) el aviso taparía sus botones y ya no hace falta.
  const modalOpen = useAnyModalLayer();
  useEffect(() => { if (modalOpen) toasts.forEach(toast => dismissToast(toast.id)); }, [modalOpen, toasts]);
  return <div className="toaster" role="status" aria-live="polite">{!modalOpen && toasts.map(toast => <ToastItem key={toast.id} toast={toast} />)}</div>;
}
