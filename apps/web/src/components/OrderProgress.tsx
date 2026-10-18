import { CheckCircle2, Circle } from "lucide-react";
import type { OrderStatus, PaymentMethod } from "@vital-forge/shared-logic";
import { ecuadorDateTime } from "../lib/orderStatus";

// CU10: avance del pedido compartido por «Consulta tu pedido» (invitado) y «Mis pedidos» (cuenta): mismas
// reglas en los dos lugares. Las fechas salen solo de eventos registrados; sin evento, no se inventa una.
type Step = { label: string; states: string[]; event?: (event: OrderEvent) => boolean };
export type OrderEvent = { status: OrderStatus; at: string; note: string | null };

const transferSteps: Step[] = [
  { label: "Pedido registrado", states: ["PENDING_PAYMENT", "PAYMENT_REVIEW", "PAID", "PREPARING", "SHIPPED", "COMPLETED"], event: e => e.note === "Pedido registrado" },
  { label: "Pago confirmado", states: ["PAID", "PREPARING", "SHIPPED", "COMPLETED"], event: e => e.status === "PAID" },
  { label: "Preparando", states: ["PREPARING", "SHIPPED", "COMPLETED"], event: e => e.status === "PREPARING" },
  { label: "En camino", states: ["SHIPPED", "COMPLETED"], event: e => e.status === "SHIPPED" },
  { label: "Entregado", states: ["COMPLETED"], event: e => e.status === "COMPLETED" }
];
// Contra entrega: se confirma por WhatsApp (C36) y el pago ocurre al entregar.
const deliverySteps: Step[] = [
  { label: "Pedido registrado", states: ["PENDING_PAYMENT", "PAID", "PREPARING", "SHIPPED", "COMPLETED"], event: e => e.note === "Pedido registrado" },
  { label: "Confirmado por WhatsApp", states: ["CONFIRMED", "PAID", "PREPARING", "SHIPPED", "COMPLETED"], event: e => e.note === "Pedido confirmado" },
  { label: "Preparando", states: ["PREPARING", "SHIPPED", "COMPLETED"], event: e => e.status === "PREPARING" },
  { label: "En camino", states: ["SHIPPED", "COMPLETED"], event: e => e.status === "SHIPPED" },
  { label: "Entregado y pagado", states: ["COMPLETED"], event: e => e.status === "COMPLETED" }
];

/** Lista ordenada con el paso actual marcado; texto e icono, no solo color. */
export function OrderProgress({ status, paymentMethod, confirmed, events }: { status: OrderStatus; paymentMethod: PaymentMethod; confirmed: boolean; events?: OrderEvent[] }) {
  const steps = paymentMethod === "CASH_ON_DELIVERY" ? deliverySteps : transferSteps;
  const done = steps.map(step => step.states.includes(status) || (step.states.includes("CONFIRMED") && status === "PENDING_PAYMENT" && confirmed));
  const current = done.lastIndexOf(true);
  return (
    <ol className="track-steps">
      {steps.map((step, index) => {
        const at = events?.find(event => step.event?.(event))?.at;
        return (
          <li key={step.label} className={`${done[index] ? "is-done" : ""} ${index === current ? "is-current" : ""}`} aria-current={index === current ? "step" : undefined}>
            {done[index] ? <CheckCircle2 size={20} aria-hidden="true" /> : <Circle size={20} aria-hidden="true" />}
            <span>{step.label}<span className="sr-only">{index === current ? ": paso actual" : done[index] ? ": completado" : ": pendiente"}</span>{at && done[index] && <small className="track-step-date">{ecuadorDateTime(at)}</small>}</span>
          </li>
        );
      })}
    </ol>
  );
}
