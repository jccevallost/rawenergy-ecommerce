import { type FormEvent, useEffect, useState } from "react";
import { useApolloClient, useQuery } from "@apollo/client";
import { PackageSearch, X } from "lucide-react";
import { CHECKOUT_INFO, type CheckoutInfo, MY_ORDERS, type Order } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { friendlyError } from "../lib/errors";
import { ecuadorDateTime, paymentLabels, shippingLabels, statusLabel } from "../lib/orderStatus";
import { whatsappHref } from "../lib/whatsapp";
import { useModalA11y } from "../lib/useModalA11y";
import { linkGuestOrders, ORDER_NUMBER } from "../lib/guestOrders";

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" }) : "";

export function MyOrdersDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const { dialogRef, headingRef } = useModalA11y<HTMLDivElement, HTMLHeadingElement>(onClose);
  const { data, loading, error, refetch } = useQuery<{ myOrders: Order[] }>(MY_ORDERS, { fetchPolicy: "cache-and-network" });
  const orders = data?.myOrders ?? [];
  const { data: info } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const whatsapp = info?.checkoutInfo.whatsapp;
  const hours = info?.checkoutInfo.reservationHours ?? 24;
  const client = useApolloClient();
  const [number, setNumber] = useState("");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<{ ok: boolean; text: string } | null>(null);

  // Pedidos hechos sin sesión en este navegador que aún no se enlazaron (C44).
  useEffect(() => {
    linkGuestOrders(client).then(linked => { if (linked.length) void refetch(); }).catch(() => { /* se reintenta la próxima vez */ });
  }, [client, refetch]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const value = number.trim().toUpperCase();
    if (!ORDER_NUMBER.test(value)) { setAdded({ ok: false, text: "Escribe el número tal como aparece en tu pedido, por ejemplo RE-260929-AB12C." }); return; }
    if (orders.some(order => order.orderNumber === value)) { setAdded({ ok: true, text: `El pedido ${value} ya está en tu lista.` }); return; }
    setAdding(true); setAdded(null);
    try {
      const linked = await linkGuestOrders(client, [value]);
      if (linked.length) { setNumber(""); setAdded({ ok: true, text: `Agregamos el pedido ${value}.` }); await refetch(); }
      else setAdded({ ok: false, text: `No encontramos un pedido ${value} hecho sin cuenta con el correo ${email}. Revisa el número o entra con la cuenta del correo que usaste al comprar.` });
    } catch (caught) {
      setAdded({ ok: false, text: friendlyError(caught, "No pudimos agregar el pedido. Vuelve a intentarlo.") });
    } finally { setAdding(false); }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal orders-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="my-orders-heading">
        <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Cerrar mis pedidos"><X size={20} /></button>
        <h2 id="my-orders-heading" ref={headingRef} tabIndex={-1}>Mis pedidos</h2>

        {loading && !orders.length && <p className="muted" role="status">Cargando tus pedidos…</p>}

        {error && (
          <div className="notice notice-error" role="alert">
            <span>{friendlyError(error, "No pudimos traer tus pedidos.")}</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void refetch()}>Reintentar</button>
          </div>
        )}

        {!loading && !error && !orders.length && (
          <div className="empty-cart">
            <PackageSearch size={36} aria-hidden="true" />
            <h3>Todavía no tienes pedidos</h3>
            <p>Aquí aparecen, con su estado, los pedidos que haces con tu cuenta y los que hiciste sin cuenta con este correo.</p>
          </div>
        )}

        <ul className="orders-history">
          {orders.map((order) => (
            <li key={order.id}>
              <div className="order-line">
                <b>{order.orderNumber}</b>
                <span className={`order-state state-${order.status.toLowerCase()}`}>{statusLabel(order.status, order.paymentMethod, Boolean(order.confirmedAt))}</span>
              </div>
              <small>{formatDate(order.createdAt)} · {shippingLabels[order.shippingMethod]} · {paymentLabels[order.paymentMethod]}</small>
              {order.status === "PENDING_PAYMENT" && order.paymentMethod !== "CASH_ON_DELIVERY" && order.createdAt && <p className="order-deadline">Paga antes del {ecuadorDateTime(new Date(Date.parse(order.createdAt) + hours * 3600000).toISOString())}; después se cancela automáticamente.{whatsapp && <> <a href={whatsappHref(whatsapp, `Hola RawEnergy, envío el comprobante del pedido ${order.orderNumber} por ${formatMoney(order.total)}.`)} target="_blank" rel="noopener noreferrer">Enviar comprobante por WhatsApp</a></>}</p>}
              {order.status === "PENDING_PAYMENT" && order.paymentMethod === "CASH_ON_DELIVERY" && !order.confirmedAt && order.createdAt && <p className="order-deadline">{whatsapp ? "Confírmalo por WhatsApp" : "Te contactamos para confirmarlo"} antes del {ecuadorDateTime(new Date(Date.parse(order.createdAt) + (info?.checkoutInfo.cashOnDelivery.confirmHours ?? 4) * 3600000).toISOString())}; si no, se cancela automáticamente.</p>}
              <ul className="order-products">
                {order.items.map((item) => (
                  <li key={`${order.id}-${item.variantSku}`}>
                    <span>{item.quantity}x {item.title}</span>
                    <em>{item.variantLabel}</em>
                  </li>
                ))}
              </ul>
              {order.discount && <p className="order-discount">Descuento {order.discount.code} ({order.discount.percent} %): −{formatMoney(order.discount.amount)}</p>}
              <div className="order-line total">
                <span>Envío {order.shippingFee > 0 ? formatMoney(order.shippingFee) : "gratis"}</span>
                <strong>{formatMoney(order.total)}</strong>
              </div>
            </li>
          ))}
        </ul>

        <section className="orders-add" aria-labelledby="orders-add-title">
          <h3 id="orders-add-title">¿Compraste sin cuenta?</h3>
          <p className="muted">Agrega el pedido con su número. Debe estar hecho con el correo de esta cuenta ({email}).</p>
          <form className="orders-add-form" onSubmit={add}>
            <label className="field"><span>Número de pedido</span><input value={number} onChange={event => setNumber(event.target.value)} placeholder="RE-260929-AB12C" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={30} aria-describedby={added ? "orders-add-result" : undefined} aria-invalid={added && !added.ok ? true : undefined} /></label>
            <button className="btn btn-outline" disabled={adding}>{adding ? "Buscando…" : "Agregar pedido"}</button>
          </form>
          {added && <p id="orders-add-result" className={`notice ${added.ok ? "" : "notice-error"}`} role={added.ok ? "status" : "alert"}>{added.text}</p>}
        </section>
      </div>
    </div>
  );
}
