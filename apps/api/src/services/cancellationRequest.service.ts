import { randomUUID } from "node:crypto";
import { GraphQLError } from "graphql";
import { z } from "zod";
import { operationContext, unitOfWork } from "../lib/unitOfWork.js";
import { nextStatuses, type OrderStatus } from "../validation/order.js";
import type { AuthUser } from "./auth.service.js";
import { cancellationStore } from "./cancellationRequests.store.js";
import { customerCancellation } from "./customerOrders.js";
import { orderService } from "./order.service.js";
import { notificationOutbox } from "./outbox.service.js";

// CU12: el cliente pide la cancelación cuando ya no puede hacerla solo (política del propietario, plan §8) y el
// equipo la resuelve. Aprobar cancela el pedido en la misma transacción comprobando su estado actual.
export const CANCELLATION_REASONS = { CHANGED_MIND: "Cambié de opinión", WRONG_PRODUCT: "Me equivoqué de producto o presentación", DELAY: "Ya no lo necesito a tiempo", OTHER: "Otro motivo" } as const;
const requestInput = z.object({ reason: z.enum(Object.keys(CANCELLATION_REASONS) as [keyof typeof CANCELLATION_REASONS]), note: z.string().trim().max(300).optional().default("") }).strict();
const decisionInput = z.object({ revision: z.number().int().min(0), approve: z.boolean(), publicNote: z.string().trim().max(300), internalNote: z.string().trim().max(500).optional().default("") }).strict();
const notFound = () => new GraphQLError("No encontramos ese pedido en tu cuenta.", { extensions: { code: "BAD_USER_INPUT", field: "number" } });
const changed = () => new GraphQLError("La solicitud ya fue resuelta o cambió. Actualiza la lista.", { extensions: { code: "CONFLICT" } });
const work = <T,>(fn: () => Promise<T>, actorId: string, reason: string) => operationContext.getStore() ? fn() : unitOfWork(fn, { actorId, reason });

export const cancellationRequestService = {
  /** Repetir la solicitud devuelve la pendiente: un doble clic no crea dos. */
  async request(user: AuthUser, rawNumber: unknown, raw: unknown) {
    const input = requestInput.parse(raw);
    return work(async () => {
      const order = await orderService.findOwned(user.id, rawNumber) as ({ _id?: unknown; id?: unknown; orderNumber: string; status: OrderStatus; confirmedAt?: Date | null; paymentReference?: string } | null);
      if (!order) throw notFound();
      const orderId = String(order._id ?? order.id);
      const pending = await cancellationStore.pendingFor(orderId);
      if (pending) return pending;
      // También cuando podría cancelar directamente: quien dice que ya envió su comprobante deja la cancelación
      // (y el posible reembolso) al equipo, que ve el pago aunque el sistema aún no lo tenga registrado.
      const policy = customerCancellation(order);
      if (!policy.canRequestCancellation && !policy.canCancel) throw new GraphQLError(policy.reason ?? "Este pedido ya no se puede cancelar.", { extensions: { code: "NOT_CANCELLABLE" } });
      const created = await cancellationStore.create({ id: randomUUID(), orderId, orderNumber: order.orderNumber, userId: user.id, reason: input.reason, note: input.note, status: "PENDING", publicNote: "", internalNote: "", decidedBy: null, decidedAt: null, revision: 0 });
      if (!created) return (await cancellationStore.pendingFor(orderId))!;
      await notificationOutbox.enqueue([{ kind: "OPERATOR_NOTICE", label: `solicitud de cancelación ${order.orderNumber}`, text: `Solicitud de cancelación del pedido ${order.orderNumber} (${CANCELLATION_REASONS[input.reason]}). Resuélvela en Pedidos del panel.` }]);
      return created;
    }, user.id, "Solicitud de cancelación");
  },

  async list(status: unknown) {
    const filter = z.enum(["PENDING", "APPROVED", "REJECTED", "ALL"]).default("PENDING").parse(status ?? undefined);
    const requests = await cancellationStore.list(filter);
    const orders = await Promise.all(requests.map(request => orderService.get(request.orderId)));
    return requests.map((request, index) => {
      const order = orders[index] as { status: OrderStatus; paymentMethod: string; total: number; paidAt?: Date | null; customer: { fullName: string } } | null;
      return { ...request, reasonLabel: CANCELLATION_REASONS[request.reason as keyof typeof CANCELLATION_REASONS] ?? request.reason, order: order ? { status: order.status, paymentMethod: order.paymentMethod, total: order.total, paidAt: order.paidAt ? new Date(order.paidAt).toISOString() : null, customerName: order.customer.fullName } : null };
    });
  },

  /**
   * Decisión del equipo con la revisión leída: solo una gana. Aprobar comprueba que el pedido todavía se pueda
   * cancelar y lo cancela en la misma transacción (stock, descuento, historial y avisos); si ya salió, no.
   */
  async resolve(actor: AuthUser, id: string, raw: unknown) {
    const input = decisionInput.parse(raw);
    if (!input.approve && input.publicNote.length < 5) throw new GraphQLError("Escribe al cliente el motivo del rechazo (al menos 5 caracteres).", { extensions: { code: "BAD_USER_INPUT", field: "publicNote" } });
    return work(async () => {
      const request = await cancellationStore.get(z.string().uuid().parse(id));
      if (!request || request.status !== "PENDING" || request.revision !== input.revision) throw changed();
      if (input.approve) {
        const order = await orderService.get(request.orderId) as { status: OrderStatus; paymentMethod?: string; confirmedAt?: Date | null } | null;
        if (!order) throw new GraphQLError("Pedido no encontrado", { extensions: { code: "BAD_USER_INPUT" } });
        if (order.status !== "CANCELLED" && !nextStatuses(order.status, order.paymentMethod, order.confirmedAt).includes("CANCELLED")) {
          throw new GraphQLError("Este pedido ya no se puede cancelar (ya salió o terminó). Rechaza la solicitud explicando el motivo.", { extensions: { code: "NOT_CANCELLABLE" } });
        }
        if (!await cancellationStore.decide(request.id, request.revision, { status: "APPROVED", publicNote: input.publicNote || "Aprobamos tu solicitud y cancelamos el pedido.", internalNote: input.internalNote, decidedBy: actor.id })) throw changed();
        if (order.status !== "CANCELLED") await orderService.updateStatus(request.orderId, "CANCELLED", { reason: "Cancelación aprobada por el equipo", expectedStatus: order.status });
      } else if (!await cancellationStore.decide(request.id, request.revision, { status: "REJECTED", publicNote: input.publicNote, internalNote: input.internalNote, decidedBy: actor.id })) throw changed();
      return (await cancellationStore.get(request.id))!;
    }, actor.id, input.approve ? "Cancelación aprobada" : "Cancelación rechazada");
  }
};
