import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";
import { idTypeLabel, type IdType } from "../data/ecuador.js";
import { type CommerceSettings, commerceSettingsService } from "./commerceSettings.service.js";
import type { OrderStatus } from "../validation/order.js";

type MailOrder = {
  orderNumber: string;
  paymentMethod?: "BANK_TRANSFER" | "CASH_ON_DELIVERY";
  customer: { fullName: string; email: string; phone: string; province: string; city: string; address: string; reference?: string | null; idType?: string | null; idNumber?: string | null };
  items: Array<{ title: string; variantLabel: string; quantity: number; unitPrice: number; lineTotal: number }>;
  shippingMethod: "EXPRESS_QUITO_VALLES" | "SERVIENTREGA_NATIONAL";
  subtotal: number;
  discount?: { code: string; percent: number; amount: number } | null;
  shippingFee: number;
  total: number;
  status: OrderStatus;
  paymentReference?: string | null;
};

const money = (value: number) => `$${value.toFixed(2)}`;

const shippingLabels: Record<MailOrder["shippingMethod"], string> = {
  EXPRESS_QUITO_VALLES: "Envio express en Quito y Valles, entre 2 y 4 horas",
  SERVIENTREGA_NATIONAL: "Envio nacional por Servientrega, 1 dia laborable"
};

/** Que decirle al cliente en cada estado. Sin frase, no se envia correo. */
const statusMessages: Partial<Record<OrderStatus, { subject: string; body: string }>> = {
  PAYMENT_REVIEW: { subject: "Recibimos tu comprobante", body: "Estamos validando tu transferencia. Te escribimos apenas quede confirmada." },
  PAID: { subject: "Pago confirmado", body: "Confirmamos tu pago. Ya estamos preparando tu pedido." },
  PREPARING: { subject: "Estamos preparando tu pedido", body: "Tu pedido esta siendo alistado para el despacho." },
  SHIPPED: { subject: "Tu pedido va en camino", body: "Tu pedido salio a la direccion que registraste." },
  COMPLETED: { subject: "Pedido entregado", body: "Tu pedido fue entregado. Gracias por comprar con nosotros." },
  CANCELLED: { subject: "Pedido cancelado", body: "Cancelamos tu pedido. Si no fuiste tu quien lo pidio, respondenos este correo." }
};
/** Estados que envían correo al cliente; los demás no generan aviso. */
export const hasStatusMail = (status: OrderStatus) => Boolean(statusMessages[status]);

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const layout = (title: string, inner: string, footer?: string) => `<!doctype html>
<html lang="es"><body style="margin:0;background:#f4f5f2;font-family:Helvetica,Arial,sans-serif;color:#1a1e1b">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px">
    <div style="font-size:20px;font-weight:bold;letter-spacing:-.5px;margin-bottom:18px">${escape(env.STORE_NAME)}</div>
    <div style="background:#fff;border:1px solid #e1e4df;border-radius:14px;padding:24px">
      <h1 style="margin:0 0 14px;font-size:21px;line-height:1.25">${escape(title)}</h1>
      ${inner}
    </div>
    <p style="margin:16px 0 0;font-size:11px;color:#7a817b;line-height:1.6">
      ${footer ?? `Este correo se genero automaticamente por tu pedido en ${escape(env.STORE_NAME)}.
      ${env.STORE_WHATSAPP ? `Si necesitas ayuda, escribenos al ${escape(env.STORE_WHATSAPP)}.` : ""}`}
    </p>
  </div>
</body></html>`;

const itemsTable = (order: MailOrder) => `
  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
    ${order.items.map((item) => `
      <tr>
        <td style="padding:7px 0;border-bottom:1px solid #f0f2ee">
          ${item.quantity}x ${escape(item.title)}<br>
          <span style="color:#7a817b;font-size:11px">${escape(item.variantLabel)}</span>
        </td>
        <td style="padding:7px 0;border-bottom:1px solid #f0f2ee;text-align:right;white-space:nowrap">${money(item.lineTotal)}</td>
      </tr>`).join("")}
    <tr>
      <td style="padding:7px 0;color:#7a817b">Subtotal</td>
      <td style="padding:7px 0;text-align:right">${money(order.subtotal)}</td>
    </tr>
    ${order.discount ? `<tr>
      <td style="padding:0 0 7px;color:#7a817b">Descuento ${escape(order.discount.code)} (${order.discount.percent} %)</td>
      <td style="padding:0 0 7px;text-align:right">-${money(order.discount.amount)}</td>
    </tr>` : ""}
    <tr>
      <td style="padding:0 0 7px;color:#7a817b">Envio</td>
      <td style="padding:0 0 7px;text-align:right">${order.shippingFee > 0 ? money(order.shippingFee) : "Gratis"}</td>
    </tr>
    <tr>
      <td style="padding:10px 0 0;border-top:2px solid #1a1e1b;font-weight:bold">Total</td>
      <td style="padding:10px 0 0;border-top:2px solid #1a1e1b;text-align:right;font-weight:bold;font-size:17px">${money(order.total)}</td>
    </tr>
  </table>`;

const bankBlock = (bank: CommerceSettings["bank"]) => {
  const { name, accountType, accountNumber, holder, document } = bank;
  if (!name || !accountNumber) {
    return `<p style="margin:0;font-size:13px;line-height:1.6">Te escribimos en breve con los datos para la transferencia.</p>`;
  }
  const rows = [
    ["Banco", name],
    ["Tipo de cuenta", accountType],
    ["Numero de cuenta", accountNumber],
    ["A nombre de", holder],
    ["Identificacion", document]
  ].filter(([, value]) => Boolean(value));
  return `
    <div style="background:#f7f8f5;border-radius:10px;padding:16px;margin:16px 0">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:bold;color:#7a817b;margin-bottom:10px">Datos para la transferencia</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${rows.map(([label, value]) => `<tr>
          <td style="padding:3px 0;color:#7a817b">${escape(String(label))}</td>
          <td style="padding:3px 0;text-align:right;font-weight:bold">${escape(String(value))}</td>
        </tr>`).join("")}
      </table>
    </div>`;
};

class MailService {
  async sendPasswordReset(to: string, url: string) {
    return this.send(to, "Restablecer contraseña", layout("Restablecer contraseña", `<p>Este enlace vence en 30 minutos y funciona una sola vez.</p><p><a href="${escape(url)}">Crear nueva contraseña</a></p><p>Si no solicitaste el cambio, puedes ignorar este mensaje.</p>`, "Acceso a tu cuenta"));
  }

  private transporter: Transporter | null = null;

  /** Sin credenciales SMTP la tienda sigue funcionando: los envios solo se anotan. */
  get enabled() {
    return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.mailFrom);
  }

  private get client() {
    if (!this.enabled) return null;
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        // 465 es TLS directo; el resto de puertos negocian STARTTLS.
        secure: env.SMTP_PORT === 465,
        // Un proveedor colgado no puede retener el aviso más que la reserva de la bandeja (5 min).
        connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
        auth: { user: env.SMTP_USER!, pass: env.SMTP_PASSWORD! }
      });
    }
    return this.transporter;
  }

  /**
   * Nunca lanza. Un pedido valido no se puede perder porque el proveedor de
   * correo este caido, asi que el fallo se registra y la compra sigue.
   */
  private async send(to: string, subject: string, html: string) {
    if (!this.enabled) {
      console.info(`[mail] sin configurar; no se envio "${subject}" a ${to}`);
      return false;
    }
    try {
      await this.client!.sendMail({ from: env.mailFrom, to, subject: `${subject} · ${env.STORE_NAME}`, html });
      return true;
    } catch (error) {
      console.error(`[mail] fallo el envio de "${subject}" a ${to}`, error);
      return false;
    }
  }

  async sendOrderConfirmation(order: MailOrder) {
    const onDelivery = order.paymentMethod === "CASH_ON_DELIVERY";
    const settings = await commerceSettingsService.get();
    // Con los datos bancarios ocultos en la web, el correo tampoco los muestra: se dan por WhatsApp.
    const whatsapp = env.STORE_WHATSAPP ? `https://wa.me/${env.STORE_WHATSAPP.replace(/\D/g, "")}?text=${encodeURIComponent(`Hola RawEnergy, quiero continuar mi compra del pedido ${order.orderNumber}.`)}` : "";
    const chat = whatsapp ? `<a href="${escape(whatsapp)}" style="color:#1a1e1b;font-weight:bold">por WhatsApp</a>` : "por WhatsApp";
    const payment = onDelivery
      ? `<p style="margin:0;font-size:13px;line-height:1.6">Pagas <strong>al recibir</strong> tu pedido. Confirmalo ${chat} y envianos tu ubicacion en las proximas ${settings.cashOnDelivery.confirmHours} horas; si no lo confirmas, se cancela automaticamente.</p>`
      : settings.showBankDetails
        ? `${bankBlock(settings.bank)}
      <p style="margin:0;font-size:13px;line-height:1.6">
        Cuando transfieras, responde este correo con el comprobante indicando el numero <strong>${escape(order.orderNumber)}</strong>.
      </p>`
        : `<p style="margin:0;font-size:13px;line-height:1.6">Escribenos ${chat} y te enviamos los datos para la transferencia. Usa el numero <strong>${escape(order.orderNumber)}</strong> como referencia.</p>`;
    const html = layout(`Recibimos tu pedido ${order.orderNumber}`, `
      <p style="margin:0;font-size:14px;line-height:1.6">Hola ${escape(order.customer.fullName.split(" ")[0] ?? "")}, tu pedido quedo registrado ${onDelivery ? "con pago contra entrega" : "y esta a la espera del pago por transferencia"}.</p>
      ${itemsTable(order)}
      ${payment}
      <p style="margin:14px 0 0;font-size:12px;color:#7a817b;line-height:1.6">
        ${escape(shippingLabels[order.shippingMethod])}.<br>
        Entrega en ${escape(order.customer.address)}, ${escape(order.customer.city)}.
      </p>`);
    return this.send(order.customer.email, `Pedido ${order.orderNumber} recibido`, html);
  }

  /** Aviso al operador: sin esto nadie se entera de que entro un pedido. */
  async sendOperatorAlert(order: MailOrder) {
    const html = layout(`Pedido nuevo ${order.orderNumber}`, `
      <p style="margin:0;font-size:14px;line-height:1.6">
        <strong>${escape(order.customer.fullName)}</strong><br>
        ${escape(order.customer.email)} · ${escape(order.customer.phone)}<br>
        ${escape(order.customer.address)}, ${escape(order.customer.city)}, ${escape(order.customer.province)}
        ${order.customer.reference ? `<br>Referencia: ${escape(order.customer.reference)}` : ""}
        ${order.customer.idNumber ? `<br>Factura: ${idTypeLabel((order.customer.idType || "CEDULA") as IdType)} ${escape(order.customer.idNumber)}` : ""}
      </p>
      ${itemsTable(order)}
      <p style="margin:0;font-size:13px;line-height:1.6">
        ${escape(shippingLabels[order.shippingMethod])} · ${order.paymentMethod === "CASH_ON_DELIVERY" ? "<strong>Pago contra entrega</strong>" : "Pago por transferencia"}.
        ${order.paymentReference ? `<br>Comprobante declarado: <strong>${escape(order.paymentReference)}</strong>` : ""}
      </p>
      ${env.STORE_URL ? `<p style="margin:16px 0 0"><a href="${escape(env.STORE_URL)}" style="font-size:13px;font-weight:bold;color:#1a1e1b">Abrir el panel</a></p>` : ""}`,
      "Aviso interno de la tienda. Lo recibe el correo configurado como operador.");
    return this.send(env.mailOperator, `Pedido nuevo ${order.orderNumber}`, html);
  }

  async sendStatusUpdate(order: MailOrder) {
    const message = statusMessages[order.status];
    if (!message) return false;
    const html = layout(message.subject, `
      <p style="margin:0;font-size:14px;line-height:1.6">${escape(message.body)}</p>
      <p style="margin:14px 0 0;font-size:13px;color:#7a817b">Pedido ${escape(order.orderNumber)} por ${money(order.total)}.</p>`);
    return this.send(order.customer.email, `${message.subject} · pedido ${order.orderNumber}`, html);
  }
}

export const mailService = new MailService();
export type { MailOrder };
