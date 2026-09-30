import type { OrderStatus, PaymentMethod, ShippingMethod } from "@vital-forge/shared-logic";

// Textos para el cliente, compartidos por «Mis pedidos» y la consulta de pedido.
export const orderStatusLabels: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Esperando tu transferencia",
  PAYMENT_REVIEW: "Revisando tu comprobante",
  PAID: "Pago confirmado",
  PREPARING: "Preparando tu pedido",
  SHIPPED: "En camino",
  COMPLETED: "Entregado",
  CANCELLED: "Cancelado",
  RETURNED: "Devuelto"
};

/**
 * Contra entrega pendiente: primero se confirma por WhatsApp (C36) y se cobra al
 * entregar; no espera una transferencia.
 */
export const statusLabel = (status: OrderStatus, paymentMethod?: PaymentMethod, confirmed = true) =>
  status === "PENDING_PAYMENT" && paymentMethod === "CASH_ON_DELIVERY" ? (confirmed ? "Confirmado · pago al recibir" : "Por confirmar por WhatsApp") : orderStatusLabels[status];

export const paymentLabels: Record<PaymentMethod, string> = { BANK_TRANSFER: "Transferencia", CASH_ON_DELIVERY: "Contra entrega" };

export const shippingLabels: Record<ShippingMethod, string> = {
  EXPRESS_QUITO_VALLES: "Express Quito y Valles",
  SERVIENTREGA_NATIONAL: "Servientrega nacional"
};

/** Fecha y hora en Ecuador, p. ej. «sáb 27 sep, 18:40». */
export const ecuadorDateTime = (value: string) => new Date(value).toLocaleString("es-EC", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil" });
