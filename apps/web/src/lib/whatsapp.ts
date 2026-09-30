import { formatMoney } from "@vital-forge/ui-core";
import { idTypeLabel, type IdType } from "./ecuador";

// Enlaces de WhatsApp con mensaje prellenado. El número viene de la API
// (STORE_WHATSAPP); si falta, la tienda no muestra botones de WhatsApp.
const digits = (value: string) => value.replace(/\D/g, "");

export const whatsappHref = (number: string, message: string) => `https://wa.me/${digits(number)}?text=${encodeURIComponent(message)}`;

/** 593983368127 → +593 98 336 8127 (formato de móvil de Ecuador). */
export function formatWhatsapp(number: string) {
  const value = digits(number);
  const local = /^593(\d{2})(\d{3})(\d{4})$/.exec(value);
  return local ? `+593 ${local[1]} ${local[2]} ${local[3]}` : `+${value}`;
}

type MessageOrder = {
  orderNumber: string;
  items: Array<{ title: string; variantLabel: string; quantity: number; lineTotal: number }>;
  subtotal: number; shippingFee: number; total: number;
  discount?: { code: string; percent: number; amount: number } | null;
  shippingMethod: string; paymentMethod?: string | null;
  customer?: { fullName: string; phone: string; city: string; province: string; address: string; reference?: string | null; idType?: string | null; idNumber?: string | null } | null;
  notes?: string | null;
};
const shippingNames: Record<string, string> = { EXPRESS_QUITO_VALLES: "Express Quito y Valles", SERVIENTREGA_NATIONAL: "Nacional por Servientrega" };

/**
 * Mensaje con el que el cliente continúa su compra por WhatsApp: pedido,
 * productos, totales, forma de pago y entrega. La atención sigue en el chat;
 * con transferencia, ahí recibe los datos de la cuenta.
 */
export function orderWhatsappMessage(order: MessageOrder, options: { bankShown?: boolean } = {}) {
  const onDelivery = order.paymentMethod === "CASH_ON_DELIVERY";
  const lines = [
    "Hola RawEnergy, quiero continuar mi compra.",
    "",
    `Pedido ${order.orderNumber}`,
    ...order.items.map(item => `• ${item.quantity} × ${item.title} (${item.variantLabel}): ${formatMoney(item.lineTotal)}`),
    "",
    `Subtotal: ${formatMoney(order.subtotal)}`,
    ...(order.discount ? [`Descuento ${order.discount.code} (${order.discount.percent} %): −${formatMoney(order.discount.amount)}`] : []),
    `Envío: ${shippingNames[order.shippingMethod] ?? order.shippingMethod}, ${order.shippingFee > 0 ? formatMoney(order.shippingFee) : "gratis"}`,
    `Total: ${formatMoney(order.total)}`,
    onDelivery ? "Pago: contra entrega (pago al recibir). Confirmo mi pedido y les envío mi ubicación." : options.bankShown ? "Pago: transferencia bancaria. Les envío el comprobante." : "Pago: transferencia bancaria. Por favor, envíenme los datos para transferir."
  ];
  const customer = order.customer;
  if (customer) {
    lines.push("", `Entrega: ${customer.fullName}, ${customer.address}${customer.reference ? ` (${customer.reference})` : ""}, ${customer.city}, ${customer.province}`, `Celular: ${customer.phone}`);
    if (customer.idNumber) lines.push(`Identificación para la factura: ${idTypeLabel((customer.idType || "CEDULA") as IdType)} ${customer.idNumber}`);
  }
  if (order.notes) lines.push(`Notas: ${order.notes}`);
  return lines.join("\n");
}
