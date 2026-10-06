import { useApolloClient, useMutation, useQuery } from "@apollo/client";
import { useRef, useState } from "react";
import { MapPin, MessageCircle } from "lucide-react";
import { CHECKOUT_INFO, CONFIRM_CASH_ON_DELIVERY, type CheckoutInfo, type Order } from "@vital-forge/shared-logic";
import { customerMessage, customerWhatsappHref } from "../lib/whatsapp";
import "../features/settings/commerce.css";

const when = (value: string | Date) => new Date(value).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short", timeZone: "America/Guayaquil" });

/**
 * Contra entrega (C36): el cliente confirma por WhatsApp y envía su ubicación.
 * Hasta marcarlo aquí no se puede preparar, y el servidor lo cancela solo al vencer el plazo.
 */
export function CashOnDeliveryConfirm({ order, readonly }: { order: Order; readonly?: boolean }) {
  const client = useApolloClient();
  const { data } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const [confirm] = useMutation(CONFIRM_CASH_ON_DELIVERY);
  const [location, setLocation] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const running = useRef(false);
  if (order.paymentMethod !== "CASH_ON_DELIVERY") return null;

  if (order.confirmedAt) {
    const place = order.deliveryLocation?.trim();
    return (
      <p className="cod-confirmed"><MessageCircle size={15} aria-hidden="true" /> Confirmado por WhatsApp el {when(order.confirmedAt)}
        {place && <> · <MapPin size={15} aria-hidden="true" /> {/^https?:\/\//i.test(place) ? <a href={place} target="_blank" rel="noopener noreferrer">Ver ubicación</a> : place}</>}
      </p>
    );
  }
  if (order.status !== "PENDING_PAYMENT") return null;

  const hours = data?.checkoutInfo.cashOnDelivery.confirmHours ?? 4;
  const deadline = order.createdAt ? when(new Date(Date.parse(order.createdAt) + hours * 3600000)) : null;
  const submit = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setMessage("");
    try {
      await confirm({ variables: { id: order.id, location: location.trim() || null } });
      await client.refetchQueries({ include: ["Orders", "StaffHome"] }).catch(() => undefined);
      // Al recargar, la tarjeta muestra «Confirmado por WhatsApp» y habilita «Preparando».
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo confirmar."); }
    finally { running.current = false; setBusy(false); }
  };
  // La tienda puede abrir la conversación con el mensaje listo si el cliente no escribió (C74).
  const chat = customerWhatsappHref(order.customer.phone, customerMessage(order, deadline));
  return (
    <div className="cod-pending" role="group" aria-label={`Confirmación por WhatsApp del pedido ${order.orderNumber}`}>
      <p><b>Por confirmar por WhatsApp.</b> Pide la ubicación en el chat. {deadline ? `Si no se confirma hasta el ${deadline}, se cancela solo.` : ""}</p>
      {!readonly && <>
        {chat && <a className="cod-chat" href={chat} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} aria-hidden="true" /> Escribirle por WhatsApp</a>}
        <label>Ubicación que envió el cliente (opcional)<input value={location} maxLength={300} placeholder="Enlace de Google Maps o referencia" onChange={event => setLocation(event.target.value)} /></label>
        <button type="button" className="publish" disabled={busy} onClick={() => void submit()}>{busy ? "Confirmando…" : "Confirmado por WhatsApp"}</button>
      </>}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
