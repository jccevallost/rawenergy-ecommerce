import type { OrderStatus } from "../validation/order.js";
import { CANCELLATION_BLOCK_LIMIT } from "./blockedIdentities.js";

// CU09: lo que el cliente ve de sus pedidos. Proyección propia: sin costos, lotes, ubicación de bodega,
// actores, notas internas ni `operations` (plan §7.1). Se usa tanto en «Mis pedidos» como en el detalle.

type PartyOrder = {
  customer: { fullName: string; email: string; phone: string; idType?: string | null; idNumber?: string | null };
  delivery?: { recipientName?: string | null; recipientPhone?: string | null; addressLabel?: string | null } | null;
  billing?: { name: string; idType?: string | null; idNumber?: string | null; email?: string | null } | null;
};

/** CU07: quién recibe. Pedidos anteriores (solo `customer`) = el comprador. */
export function orderRecipient(order: PartyOrder) {
  const other = Boolean(order.delivery?.recipientName);
  return { name: other ? order.delivery!.recipientName! : order.customer.fullName, phone: other ? order.delivery!.recipientPhone ?? "" : order.customer.phone, sameAsBuyer: !other, addressLabel: order.delivery?.addressLabel || null };
}

/** CU07: a nombre de quién se factura. Sin factura distinta = el comprador. */
export function orderInvoice(order: PartyOrder) {
  return order.billing?.idNumber
    ? { name: order.billing.name, idType: order.billing.idType ?? null, idNumber: order.billing.idNumber, email: order.billing.email || order.customer.email, sameAsBuyer: false }
    : { name: order.customer.fullName, idType: order.customer.idType || null, idNumber: order.customer.idNumber || null, email: order.customer.email, sameAsBuyer: true };
}

type CancellableOrder = { status: OrderStatus | string; confirmedAt?: Date | string | null; paymentReference?: string | null };
/**
 * Política del propietario (16/10/2026, plan §8): el cliente cancela mientras el pedido no esté confirmado ni
 * tenga comprobante enviado (estado PAYMENT_REVIEW o número de comprobante). Con pago recibido o por verificar,
 * solo el operador cancela; el cliente puede pedírselo. La interfaz nunca decide esto por su cuenta.
 */
export function customerCancellation(order: CancellableOrder) {
  const proof = order.status === "PAYMENT_REVIEW" || Boolean(order.paymentReference?.trim());
  if (order.status === "PENDING_PAYMENT" && !order.confirmedAt && !proof) return { canCancel: true, canRequestCancellation: false, reason: null };
  const request = (reason: string) => ({ canCancel: false, canRequestCancellation: true, reason });
  const none = (reason: string) => ({ canCancel: false, canRequestCancellation: false, reason });
  switch (order.status) {
    case "PENDING_PAYMENT": return request(proof ? "Ya enviaste tu comprobante: la cancelación la revisa nuestro equipo." : "Tu pedido ya está confirmado: la cancelación la revisa nuestro equipo.");
    case "PAYMENT_REVIEW": return request("Tu pago está por verificar: la cancelación la revisa nuestro equipo.");
    case "PAID": case "PREPARING": return request("Ya recibimos tu pago: la cancelación la revisa nuestro equipo.");
    case "SHIPPED": case "COMPLETED": return none("El pedido ya salió. Si necesitas devolver algo, escríbenos.");
    case "CANCELLED": return none("Este pedido ya está cancelado.");
    case "RETURNED": return none("Este pedido fue devuelto.");
    default: return none("No se puede cancelar este pedido.");
  }
}

type HistoryEntry = { from?: string; to?: string; at?: Date | string; reason?: string };
// Notas que sí se muestran al cliente; cualquier otro motivo del historial es interno.
const PUBLIC_NOTES: Array<[RegExp, string]> = [
  [/^Confirmado por WhatsApp/, "Pedido confirmado"],
  [/^Vencido: sin pago/, "Cancelado automáticamente: no recibimos el pago a tiempo"],
  [/^Contra entrega sin confirmar/, "Cancelado automáticamente: no se confirmó a tiempo"],
  [/^Cancelado por el cliente/, "Cancelaste el pedido"],
  [/^Cancelación aprobada por el equipo/, "Cancelado por nuestro equipo a tu pedido"]
];

/** Eventos públicos: cambios de estado reales y confirmaciones, sin actor ni motivos internos. */
export function publicEvents(history: HistoryEntry[] | undefined) {
  return (history ?? []).flatMap(entry => {
    if (!entry.to || !entry.at) return [];
    const note = PUBLIC_NOTES.find(([pattern]) => pattern.test(entry.reason ?? ""))?.[1] ?? null;
    const changed = entry.from !== entry.to;
    if (!changed && !note) return [];
    return [{ status: entry.to as OrderStatus, at: new Date(entry.at).toISOString(), note: changed && !note && !entry.from ? "Pedido registrado" : note }];
  });
}

type ViewOrder = PartyOrder & CancellableOrder & {
  orderNumber: string; createdAt: Date | string; paidAt?: Date | string | null;
  paymentMethod: string; shippingMethod: string;
  customer: PartyOrder["customer"] & { province: string; city: string; address: string; reference?: string | null };
  items: Array<{ variantSku: string; title: string; variantLabel: string; image?: string | null; quantity: number; unitPrice: number; lineTotal: number }>;
  subtotal: number; discount?: { code: string; percent: number; amount: number } | null; shippingFee: number; total: number;
  history?: HistoryEntry[];
  returns?: Array<{ items?: Array<{ variantSku: string; quantity: number }> }>;
  refund?: { at?: Date | string | null; amount?: number | null } | null;
};
const iso = (value?: Date | string | null) => value ? new Date(value).toISOString() : null;

type RequestInfo = { status: string; reason: string; note: string; publicNote: string; createdAt: string; decidedAt: string | null };
/**
 * `cancellationsSoFar`: cancelaciones seguidas de la cuenta, para advertir antes de la que bloquearía.
 * `request`: la solicitud de cancelación más reciente del pedido (CU12); con una pendiente no se pide otra.
 */
export function customerOrderView(order: ViewOrder, cancellationsSoFar = 0, request?: RequestInfo | null) {
  const policy = customerCancellation(order);
  const pending = request?.status === "PENDING";
  const returned = new Map<string, number>();
  for (const entry of order.returns ?? []) for (const item of entry.items ?? []) returned.set(item.variantSku, (returned.get(item.variantSku) ?? 0) + item.quantity);
  return {
    orderNumber: order.orderNumber, createdAt: iso(order.createdAt)!, status: order.status as OrderStatus,
    paymentMethod: order.paymentMethod, shippingMethod: order.shippingMethod, confirmedAt: iso(order.confirmedAt), paidAt: iso(order.paidAt),
    items: order.items.map(item => ({ variantSku: item.variantSku, title: item.title, variantLabel: item.variantLabel, image: item.image || null, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.lineTotal, returnedQuantity: returned.get(item.variantSku) ?? 0 })),
    subtotal: order.subtotal, discount: order.discount ?? null, shippingFee: order.shippingFee, total: order.total,
    delivery: { province: order.customer.province, city: order.customer.city, address: order.customer.address, reference: order.customer.reference ?? "" },
    recipient: orderRecipient(order), invoice: orderInvoice(order),
    events: publicEvents(order.history),
    refund: order.refund?.at ? { at: iso(order.refund.at)!, amount: order.refund.amount ?? null } : null,
    cancellation: pending
      ? { canCancel: false, canRequestCancellation: false, reason: "Tu solicitud de cancelación está en revisión.", blocksAccount: false }
      : { ...policy, blocksAccount: policy.canCancel && cancellationsSoFar >= CANCELLATION_BLOCK_LIMIT - 1 },
    cancellationRequest: request ? { status: request.status, reason: request.reason, createdAt: request.createdAt, decidedAt: request.decidedAt, publicNote: request.publicNote || null } : null
  };
}
export type CustomerOrderView = ReturnType<typeof customerOrderView>;

/** Filtros de «Mis pedidos». Finalizados incluye devueltos: no se ocultan devoluciones. */
export const ORDER_GROUPS: Record<"ALL" | "ACTIVE" | "FINISHED" | "CANCELLED", OrderStatus[] | null> = {
  ALL: null,
  ACTIVE: ["PENDING_PAYMENT", "PAYMENT_REVIEW", "PAID", "PREPARING", "SHIPPED"],
  FINISHED: ["COMPLETED", "RETURNED"],
  CANCELLED: ["CANCELLED"]
};
