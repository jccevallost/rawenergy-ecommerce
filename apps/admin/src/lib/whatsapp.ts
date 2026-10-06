import { formatMoney } from "@vital-forge/ui-core";
import type { Order } from "@vital-forge/shared-logic";

/**
 * Enlace para escribirle al cliente por WhatsApp desde el panel (C74), con el mensaje listo.
 * El celular se guarda como 09XXXXXXXX (API, `normalizeMobile`); wa.me necesita 5939XXXXXXXX.
 * Devuelve null si el número no es un celular de Ecuador.
 */
export function customerWhatsappHref(phone: string, message: string) {
  const digits = phone.replace(/\D/g, "");
  const international = /^09\d{8}$/.test(digits) ? `593${digits.slice(1)}` : /^5939\d{8}$/.test(digits) ? digits : null;
  return international ? `https://wa.me/${international}?text=${encodeURIComponent(message)}` : null;
}

type MessageOrder = Pick<Order, "orderNumber" | "total" | "paymentMethod" | "status" | "confirmedAt" | "items"> & { customer: Pick<Order["customer"], "fullName" | "address" | "city"> };

/**
 * Mensaje con el que la tienda abre la conversación. Contra entrega sin confirmar: pide
 * confirmar y la ubicación, con el plazo. Transferencia pendiente: recuerda el pago.
 */
export function customerMessage(order: MessageOrder, deadline?: string | null) {
  const name = order.customer.fullName.trim().split(/\s+/)[0] ?? "";
  const hello = `Hola${name ? ` ${name}` : ""}, te escribimos de RawEnergy por tu pedido ${order.orderNumber}`;
  if (order.status === "PENDING_PAYMENT" && order.paymentMethod === "CASH_ON_DELIVERY" && !order.confirmedAt) {
    return [
      `${hello} de ${formatMoney(order.total)} con pago contra entrega:`,
      ...order.items.map(item => `• ${item.quantity} × ${item.title} (${item.variantLabel})`),
      `Entrega: ${order.customer.address}, ${order.customer.city}.`,
      "",
      `¿Nos confirmas el pedido y nos envías tu ubicación por aquí?${deadline ? ` Si no lo confirmas antes del ${deadline}, se cancela automáticamente.` : ""}`
    ].join("\n");
  }
  // Contra entrega confirmado sigue «pendiente de pago» hasta cobrarse al entregar: no se pide comprobante.
  if (order.status === "PENDING_PAYMENT" && order.paymentMethod !== "CASH_ON_DELIVERY") return `${hello} de ${formatMoney(order.total)}. Quedamos atentos a tu comprobante de transferencia; usa el número de pedido como referencia.`;
  return `${hello}.`;
}
