import { type FormEvent, useEffect, useRef, useState } from "react";
import { useLazyQuery, useQuery } from "@apollo/client";
import { CheckCircle2, Circle, Clock3, MessageCircle, XCircle } from "lucide-react";
import { CHECKOUT_INFO, type CheckoutInfo, TRACK_ORDER, type TrackedOrder } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { catalogHref } from "../lib/catalogUrl";
import { friendlyError } from "../lib/errors";
import { readLastOrder } from "../lib/lastOrder";
import { ecuadorDateTime, paymentLabels, shippingLabels, statusLabel } from "../lib/orderStatus";
import { Link, usePageEntry } from "../lib/router";
import { useSingleFlight } from "../lib/useSingleFlight";
import { orderWhatsappMessage, whatsappHref } from "../lib/whatsapp";

const transferSteps = [
  { label: "Pedido registrado", states: ["PENDING_PAYMENT", "PAYMENT_REVIEW", "PAID", "PREPARING", "SHIPPED", "COMPLETED"] },
  { label: "Pago confirmado", states: ["PAID", "PREPARING", "SHIPPED", "COMPLETED"] },
  { label: "Preparando", states: ["PREPARING", "SHIPPED", "COMPLETED"] },
  { label: "En camino", states: ["SHIPPED", "COMPLETED"] },
  { label: "Entregado", states: ["COMPLETED"] }
];
// Contra entrega: se confirma por WhatsApp (C36) y el pago ocurre al entregar.
const deliverySteps = [
  { label: "Pedido registrado", states: ["PENDING_PAYMENT", "PAID", "PREPARING", "SHIPPED", "COMPLETED"] },
  { label: "Confirmado por WhatsApp", states: ["CONFIRMED", "PAID", "PREPARING", "SHIPPED", "COMPLETED"] },
  { label: "Preparando", states: ["PREPARING", "SHIPPED", "COMPLETED"] },
  { label: "En camino", states: ["SHIPPED", "COMPLETED"] },
  { label: "Entregado y pagado", states: ["COMPLETED"] }
];

function OrderResult({ order, info }: { order: TrackedOrder; info?: CheckoutInfo }) {
  const onDelivery = order.paymentMethod === "CASH_ON_DELIVERY";
  const pending = !onDelivery && (order.status === "PENDING_PAYMENT" || order.status === "PAYMENT_REVIEW");
  const closed = order.status === "CANCELLED" || order.status === "RETURNED";
  const whatsapp = info?.whatsapp;
  return (
    <article className="track-result" aria-labelledby="track-result-title">
      <header>
        <p className="eyebrow">Pedido {order.orderNumber}</p>
        <h2 id="track-result-title">{statusLabel(order.status, order.paymentMethod, !order.awaitingConfirmation)}</h2>
        <p className="muted">Registrado el {ecuadorDateTime(order.createdAt)} · {shippingLabels[order.shippingMethod]} · {paymentLabels[order.paymentMethod]}</p>
      </header>
      {closed ? (
        <p className="notice notice-error reserve-note"><XCircle size={18} aria-hidden="true" /> {order.status === "CANCELLED" ? "Este pedido fue cancelado y sus productos volvieron al catálogo. Si ya transferiste, escríbenos con tu comprobante." : "Este pedido fue devuelto."}</p>
      ) : (
        <ol className="track-steps">
          {(onDelivery ? deliverySteps : transferSteps).map(step => {
            const done = step.states.includes(order.status) || (step.states.includes("CONFIRMED") && order.status === "PENDING_PAYMENT" && !order.awaitingConfirmation);
            return <li key={step.label} className={done ? "is-done" : ""}>{done ? <CheckCircle2 size={20} aria-hidden="true" /> : <Circle size={20} aria-hidden="true" />}<span>{step.label}<span className="sr-only">{done ? ": completado" : ": pendiente"}</span></span></li>;
          })}
        </ol>
      )}
      {order.status === "PENDING_PAYMENT" && order.reservedUntil && order.awaitingConfirmation && (
        <p className="notice reserve-note"><Clock3 size={18} aria-hidden="true" /><span>Confírmalo por WhatsApp y envíanos tu ubicación antes del <b>{ecuadorDateTime(order.reservedUntil)}</b>; si no, el pedido se cancela automáticamente.</span></p>
      )}
      {order.status === "PENDING_PAYMENT" && order.reservedUntil && !onDelivery && (
        <p className="notice reserve-note"><Clock3 size={18} aria-hidden="true" /><span>Reservamos tus productos hasta el <b>{ecuadorDateTime(order.reservedUntil)}</b>; si no recibimos el pago, el pedido se cancela automáticamente.</span></p>
      )}
      {pending && info?.bank && (
        <section className="bank-instructions" aria-labelledby="track-bank">
          <h3 id="track-bank">Datos para la transferencia</h3>
          <dl><dt>Banco</dt><dd>{info.bank.name}</dd><dt>Tipo de cuenta</dt><dd>{info.bank.accountType || "Consulta con la tienda"}</dd><dt>Cuenta</dt><dd>{info.bank.accountNumber}</dd><dt>Titular</dt><dd>{info.bank.holder}</dd><dt>Referencia</dt><dd>{order.orderNumber}</dd></dl>
        </section>
      )}
      {(pending || (onDelivery && !closed && order.status !== "COMPLETED")) && whatsapp && (
        <a className="btn btn-primary btn-lg btn-block" href={whatsappHref(whatsapp, orderWhatsappMessage(order, { bankShown: Boolean(info?.bank) }))} target="_blank" rel="noopener noreferrer">
          <MessageCircle size={20} aria-hidden="true" /> {order.awaitingConfirmation ? "Confirmar mi pedido por WhatsApp" : "Continuar mi compra por WhatsApp"}
        </a>
      )}
      {pending && !info?.bank && whatsapp && <p className="muted">Te damos los datos para transferir por WhatsApp; usa el número de pedido como referencia.</p>}
      <div className="order-summary">
        {order.items.map(item => <div key={`${item.title}-${item.variantLabel}`}><span>{item.quantity} × {item.title} <small>{item.variantLabel}</small></span><span>{formatMoney(item.lineTotal)}</span></div>)}
        {order.discount && <div className="summary-discount"><span>Descuento {order.discount.code} ({order.discount.percent} %)</span><span>−{formatMoney(order.discount.amount)}</span></div>}
        <div><span>Envío</span><span>{order.shippingFee > 0 ? formatMoney(order.shippingFee) : "Gratis"}</span></div>
        <div className="order-summary-total"><b>Total</b><strong>{formatMoney(order.total)}</strong></div>
      </div>
    </article>
  );
}

export function TrackOrderPage({ search }: { search: URLSearchParams }) {
  const heading = useRef<HTMLHeadingElement>(null);
  usePageEntry("Consulta tu pedido", heading);
  const [number, setNumber] = useState(() => (search.get("numero") ?? readLastOrder() ?? "").toUpperCase());
  const [contact, setContact] = useState("");
  const [searched, setSearched] = useState(false);
  const { data: info } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const [lookup, { data, loading, error }] = useLazyQuery<{ trackOrder: TrackedOrder | null }>(TRACK_ORDER, { fetchPolicy: "network-only" });
  const [submit] = useSingleFlight(async (event: FormEvent) => {
    event.preventDefault();
    await lookup({ variables: { orderNumber: number.trim(), contact: contact.trim() } });
    setSearched(true);
  });
  const result = useRef<HTMLDivElement>(null);
  useEffect(() => { if (searched && !loading) result.current?.focus(); }, [searched, loading, data, error]);
  const whatsapp = info?.checkoutInfo.whatsapp;

  return (
    <div className="container track-page">
      <nav className="breadcrumb" aria-label="Ruta de navegación"><ol><li><Link to="/">Inicio</Link></li><li aria-current="page">Consulta tu pedido</li></ol></nav>
      <h1 ref={heading} tabIndex={-1}>Consulta tu pedido</h1>
      <p className="muted">Escribe el número que recibiste al confirmar (por ejemplo, RE-260926-AB12C) y el correo o el teléfono que usaste en la compra.</p>
      <form className="track-form" onSubmit={event => void submit(event)}>
        <label className="field"><span>Número de pedido</span><input required minLength={5} maxLength={30} autoComplete="off" value={number} onChange={event => setNumber(event.target.value.toUpperCase())} placeholder="RE-260926-AB12C" /></label>
        <label className="field"><span>Correo o teléfono de la compra</span><input required minLength={5} maxLength={120} autoComplete="email" value={contact} onChange={event => setContact(event.target.value)} /></label>
        <button className="btn btn-primary btn-lg" disabled={loading}>{loading ? "Consultando…" : "Consultar"}</button>
      </form>
      <div ref={result} tabIndex={-1} className="track-output" aria-live="polite">
        {error ? <p className="notice notice-error" role="alert">{friendlyError(error, "No pudimos consultar el pedido. Vuelve a intentarlo.")}</p>
          : searched && !loading && data && !data.trackOrder ? (
            <div className="notice" role="alert">
              <span>No encontramos un pedido con esos datos. Revisa el número y usa el mismo correo o teléfono de la compra.</span>
              {whatsapp && <a href={whatsappHref(whatsapp, `Hola RawEnergy, necesito ayuda con mi pedido ${number}.`)} target="_blank" rel="noopener noreferrer">Pedir ayuda por WhatsApp</a>}
            </div>
          ) : data?.trackOrder ? <OrderResult order={data.trackOrder} info={info?.checkoutInfo} /> : null}
      </div>
      <p className="muted track-more">¿Buscas más productos? <Link to={catalogHref()}>Ver catálogo</Link></p>
    </div>
  );
}
