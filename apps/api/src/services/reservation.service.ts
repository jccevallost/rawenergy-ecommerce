import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { auditService, redact } from "./audit.service.js";
import { commerceSettingsService } from "./commerceSettings.service.js";
import { orderService } from "./order.service.js";

// Un pedido sin pago reserva su stock solo durante ORDER_RESERVATION_HOURS
// (24 h por decisión del propietario). Después se cancela y el stock vuelve al
// catálogo una sola vez. Los pedidos en revisión de comprobante o pagados no se tocan.
// Contra entrega (C36): si no se confirma por WhatsApp en `confirmHours` (4 h), se cancela igual.
export const reservationService = {
  async expire(now = new Date(), hours = env.ORDER_RESERVATION_HOURS) {
    const cutoff = new Date(now.getTime() - hours * 3600000);
    const reason = `Vencido: sin pago en ${hours} horas`;
    let cancelled = 0;
    for (const id of await orderService.unpaidBefore(cutoff)) {
      try {
        await auditService.run({ user: null, requestId: randomUUID(), ip: "tarea-programada" }, "expireUnpaidOrder", "orders", id, { hours }, null,
          () => orderService.updateStatus(id, "CANCELLED", { reason, expectedStatus: "PENDING_PAYMENT" }),
          { transactional: true, snapshot: async () => redact(await orderService.get(id)) });
        cancelled++;
      } catch {
        // Se pagó, pasó a revisión o cambió mientras tanto: no corresponde cancelarlo.
      }
    }
    const { confirmHours } = (await commerceSettingsService.get()).cashOnDelivery;
    const codCutoff = new Date(now.getTime() - confirmHours * 3600000);
    const codReason = `Contra entrega sin confirmar por WhatsApp en ${confirmHours} horas`;
    for (const id of await orderService.unconfirmedBefore(codCutoff)) {
      try {
        await auditService.run({ user: null, requestId: randomUUID(), ip: "tarea-programada" }, "expireUnconfirmedOrder", "orders", id, { confirmHours }, null,
          () => orderService.updateStatus(id, "CANCELLED", { reason: codReason, expectedStatus: "PENDING_PAYMENT", expectUnconfirmed: true }),
          { transactional: true, snapshot: async () => redact(await orderService.get(id)) });
        cancelled++;
      } catch {
        // Se confirmó por WhatsApp o cambió mientras tanto: se respeta.
      }
    }
    return cancelled;
  }
};
