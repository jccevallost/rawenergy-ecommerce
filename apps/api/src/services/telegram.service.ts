import { env } from "../config/env.js";
import { idTypeLabel, type IdType } from "../data/ecuador.js";

type AlertOrder = {
  orderNumber: string;
  customer: { fullName: string; email: string; phone: string; province: string; city: string; address: string; reference?: string | null; idType?: string | null; idNumber?: string | null };
  items: Array<{ title: string; variantLabel: string; quantity: number }>;
  discount?: { code: string; amount: number } | null;
  shippingMethod: "EXPRESS_QUITO_VALLES" | "SERVIENTREGA_NATIONAL";
  total: number;
  paymentMethod?: "BANK_TRANSFER" | "CASH_ON_DELIVERY";
  paymentReference?: string | null;
};

const shippingLabels: Record<AlertOrder["shippingMethod"], string> = {
  EXPRESS_QUITO_VALLES: "Express Quito y Valles",
  SERVIENTREGA_NATIONAL: "Servientrega nacional"
};

// Telegram interpreta HTML en el mensaje, asi que el texto del cliente se escapa.
const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

class TelegramService {
  /** Sin token ni chat configurados, el aviso simplemente no se envia. */
  get enabled() {
    return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
  }

  /**
   * Aviso de pedido nuevo al telefono del operador. Llega al instante y no
   * depende de dominios ni de entregabilidad, que es justo lo que falla cuando
   * un correo de aviso se queda sin leer.
   */
  async sendOrderAlert(order: AlertOrder) {
    if (!this.enabled) {
      console.info(`[telegram] sin configurar; no se aviso del pedido ${order.orderNumber}`);
      return false;
    }
    const contacto = [
      escape(order.customer.fullName),
      `${escape(order.customer.phone)} · ${escape(order.customer.email)}`,
      `${escape(order.customer.address)}, ${escape(order.customer.city)}`
    ];
    if (order.customer.reference) contacto.push(`Referencia: ${escape(order.customer.reference)}`);
    if (order.customer.idNumber) contacto.push(`Factura: ${idTypeLabel((order.customer.idType || "CEDULA") as IdType)} ${escape(order.customer.idNumber)}`);

    const cierre = [`<b>Total $${order.total.toFixed(2)}</b> · ${shippingLabels[order.shippingMethod]}`, ...(order.discount ? [`Descuento ${escape(order.discount.code)}: -$${order.discount.amount.toFixed(2)}`] : []), order.paymentMethod === "CASH_ON_DELIVERY" ? "Pago: <b>contra entrega</b> (cobrar al entregar)" : "Pago: transferencia"];
    if (order.paymentReference) cierre.push(`Comprobante declarado: ${escape(order.paymentReference)}`);

    // Los bloques se separan con una linea en blanco.
    const texto = [
      [`<b>Pedido nuevo ${escape(order.orderNumber)}</b>`],
      contacto,
      order.items.map((item) => `• ${item.quantity}x ${escape(item.title)} (${escape(item.variantLabel)})`),
      cierre
    ].map((bloque) => bloque.join("\n")).join("\n\n");

    return this.post(texto, `el aviso del pedido ${order.orderNumber}`);
  }

  /** Aviso general al operador (p. ej. un cambio en la cuenta bancaria). */
  async sendNotice(text: string) {
    if (!this.enabled) {
      console.info(`[telegram] sin configurar; no se envio el aviso: ${text}`);
      return false;
    }
    return this.post(escape(text), "un aviso al operador");
  }

  private async post(texto: string, label: string) {
    try {
      // Un aviso que tarda no puede dejar colgado nada: se corta a los 8 segundos.
      const response = await fetch(`${env.telegramApiUrl}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: texto,
          parse_mode: "HTML",
          disable_web_page_preview: true
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) {
        console.error(`[telegram] respuesta ${response.status} al enviar ${label}`);
        return false;
      }
      return true;
    } catch (error) {
      console.error(`[telegram] fallo ${label}`, error);
      return false;
    }
  }
}

export const telegramService = new TelegramService();
export type { AlertOrder };
