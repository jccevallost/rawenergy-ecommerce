import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useApolloClient, useMutation, useQuery } from "@apollo/client";
import { ArrowLeft, Clock3, MessageCircle, Package, PackageSearch, RefreshCw, XCircle } from "lucide-react";
import { CANCEL_MY_ORDER, CHECKOUT_INFO, type CheckoutInfo, REQUEST_ORDER_CANCELLATION, type CustomerOrder, type CustomerOrderFilter, type CustomerOrderPage, MY_ORDER, MY_ORDERS_PAGE, type OrderStatus } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { OrderProgress } from "../components/OrderProgress";
import { friendlyError } from "../lib/errors";
import { ecuadorDateTime, paymentLabels, shippingLabels, statusLabel } from "../lib/orderStatus";
import { whatsappHref } from "../lib/whatsapp";
import { linkGuestOrders, ORDER_NUMBER } from "../lib/guestOrders";
import { Link, usePageEntry } from "../lib/router";

const PAGE_SIZE = 10;
const FINAL: OrderStatus[] = ["COMPLETED", "CANCELLED", "RETURNED"];
const filters: Array<[CustomerOrderFilter, string]> = [["ALL", "Todos"], ["ACTIVE", "Activos"], ["FINISHED", "Finalizados"], ["CANCELLED", "Cancelados"]];
const formatDate = (value: string) => new Date(value).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Guayaquil" });
const clock = (value: Date) => value.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", timeZone: "America/Guayaquil" });
const confirmed = (order: CustomerOrder) => Boolean(order.confirmedAt);

/** Qué pasa con el pago y qué le toca hacer a la persona, en una frase. */
function paymentSituation(order: CustomerOrder) {
  const cod = order.paymentMethod === "CASH_ON_DELIVERY";
  // CU12: «Reembolso pendiente» solo si hubo pago y aún no hay reembolso registrado; nunca se afirma uno.
  if (order.status === "CANCELLED") return order.refund ? `Reembolso registrado${order.refund.amount ? ` por ${formatMoney(order.refund.amount)}` : ""}` : order.paidAt ? "Reembolso pendiente" : "Sin cobro pendiente";
  if (order.status === "RETURNED") return order.refund ? "Devuelto · reembolso registrado" : "Devuelto";
  if (cod) return order.status === "COMPLETED" ? "Pagado al recibir" : confirmed(order) ? "Pagas al recibir" : "Confírmalo por WhatsApp";
  if (order.status === "PENDING_PAYMENT") return "Esperamos tu transferencia";
  if (order.status === "PAYMENT_REVIEW") return "Revisando tu comprobante";
  return "Pago confirmado";
}

/**
 * CU10: actualización controlada. Al abrir, al volver a la pestaña y con «Actualizar»; en un pedido activo,
 * además cada 30 s mientras la pestaña está visible, con espera creciente si falla. Se detiene en estados finales.
 */
function useRefresh(refetch: () => Promise<unknown>, poll: boolean) {
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const failures = useRef(0);
  const refresh = useCallback(async () => {
    setBusy(true);
    try { await refetch(); failures.current = 0; setStale(false); setUpdatedAt(new Date()); }
    catch { failures.current++; setStale(true); }
    finally { setBusy(false); }
  }, [refetch]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);
  useEffect(() => {
    if (!poll) return;
    let timer = 0;
    const schedule = () => { timer = window.setTimeout(tick, 30_000 * 2 ** Math.min(failures.current, 3)); };
    const tick = async () => { if (document.visibilityState === "visible") await refresh(); schedule(); };
    schedule();
    return () => window.clearTimeout(timer);
  }, [poll, refresh]);
  return { updatedAt, setUpdatedAt, stale, busy, refresh };
}

/** Miniatura con tamaño fijo y carga diferida; si la foto ya no existe, un icono en su lugar. */
function Thumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  return src && !failed
    ? <img src={src} alt="" width={56} height={56} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    : <span className="order-thumb-empty"><Package size={20} /></span>;
}

function Thumbs({ order }: { order: CustomerOrder }) {
  const shown = order.items.slice(0, 3);
  return (
    <div className="order-thumbs" aria-hidden="true">
      {shown.map(item => <Thumb key={item.variantSku} src={item.image} />)}
      {order.items.length > 3 && <span className="order-thumb-more">+{order.items.length - 3}</span>}
    </div>
  );
}

function OrderCard({ order }: { order: CustomerOrder }) {
  const units = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <li className="order-card-customer">
      <Thumbs order={order} />
      <div className="order-card-body">
        <div className="order-line"><b>{order.orderNumber}</b><span className={`order-state state-${order.status.toLowerCase()}`}>{statusLabel(order.status, order.paymentMethod, confirmed(order))}</span></div>
        <small className="muted">{formatDate(order.createdAt)} · {units} {units === 1 ? "producto" : "productos"} · {paymentSituation(order)}</small>
        <div className="order-line"><strong>{formatMoney(order.total)}</strong><Link to={`/mis-pedidos/${order.orderNumber}`} className="btn btn-outline btn-sm" aria-label={`Ver el pedido ${order.orderNumber}`}>Ver pedido</Link></div>
      </div>
    </li>
  );
}

function OrdersList({ email }: { email: string }) {
  const client = useApolloClient();
  const [filter, setFilter] = useState<CustomerOrderFilter>("ALL");
  const [more, setMore] = useState<{ orders: CustomerOrder[]; cursor: string | null; hasMore: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const { data, loading, error, refetch } = useQuery<{ myOrdersPage: CustomerOrderPage }>(MY_ORDERS_PAGE, { variables: { first: PAGE_SIZE, filter }, fetchPolicy: "cache-and-network", notifyOnNetworkStatusChange: true });
  const first = data?.myOrdersPage;
  const orders = [...(first?.orders ?? []), ...(more?.orders ?? [])];
  const hasMore = more ? more.hasMore : Boolean(first?.hasMore);
  const reload = useCallback(async () => { setMore(null); setMoreError(""); await refetch(); }, [refetch]);
  const { updatedAt, setUpdatedAt, stale, busy, refresh } = useRefresh(reload, false);
  useEffect(() => { if (first) setUpdatedAt(current => current ?? new Date()); }, [first, setUpdatedAt]);
  useEffect(() => { setMore(null); setMoreError(""); }, [filter]);

  const loadMore = async () => {
    const cursor = more ? more.cursor : first?.nextCursor;
    if (!cursor) return;
    setLoadingMore(true); setMoreError("");
    try {
      const { data: next } = await client.query<{ myOrdersPage: CustomerOrderPage }>({ query: MY_ORDERS_PAGE, variables: { first: PAGE_SIZE, after: cursor, filter }, fetchPolicy: "network-only" });
      setMore(current => ({ orders: [...(current?.orders ?? []), ...next.myOrdersPage.orders], cursor: next.myOrdersPage.nextCursor, hasMore: next.myOrdersPage.hasMore }));
    } catch (caught) { setMoreError(friendlyError(caught, "No pudimos traer más pedidos.")); }
    finally { setLoadingMore(false); }
  };

  // Pedidos hechos sin sesión en este navegador que aún no se enlazaron (C44).
  useEffect(() => { linkGuestOrders(client).then(linked => { if (linked.length) void reload(); }).catch(() => { /* se reintenta la próxima vez */ }); }, [client, reload]);
  const [typed, setTyped] = useState("");
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<{ ok: boolean; text: string } | null>(null);
  const add = async (event: FormEvent) => {
    event.preventDefault();
    const value = typed.trim().toUpperCase();
    if (!ORDER_NUMBER.test(value)) { setAdded({ ok: false, text: "Escribe el número tal como aparece en tu pedido, por ejemplo RE-260929-AB12C." }); return; }
    setAdding(true); setAdded(null);
    try {
      const linked = await linkGuestOrders(client, [value]);
      if (linked.length) { setTyped(""); setAdded({ ok: true, text: `Agregamos el pedido ${value}.` }); await reload(); }
      else setAdded({ ok: false, text: `No encontramos un pedido ${value} hecho sin cuenta con el correo ${email}. Si ya está en tu lista, no hace falta agregarlo.` });
    } catch (caught) { setAdded({ ok: false, text: friendlyError(caught, "No pudimos agregar el pedido. Vuelve a intentarlo.") }); }
    finally { setAdding(false); }
  };

  return (
    <>
      <div className="orders-toolbar">
        <div className="orders-filters" role="group" aria-label="Filtrar pedidos">
          {filters.map(([value, label]) => <button key={value} type="button" className="filter-chip" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <div className="orders-refresh">
          {updatedAt && <small className="muted">Actualizado a las {clock(updatedAt)}</small>}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void refresh()} disabled={busy}><RefreshCw size={16} aria-hidden="true" /> {busy ? "Actualizando…" : "Actualizar"}</button>
        </div>
      </div>
      {stale && first && <p className="notice" role="status">No pudimos actualizar; mostramos los datos de la última consulta.</p>}
      {loading && !first && <p className="muted loading-line" role="status">Cargando tus pedidos…</p>}
      {error && !first && (
        <div className="notice notice-error" role="alert"><span>{friendlyError(error, "No pudimos traer tus pedidos.")}</span><button type="button" className="btn btn-outline btn-sm" onClick={() => void refresh()}>Reintentar</button></div>
      )}
      {first && !orders.length && (filter === "ALL"
        ? <div className="empty-cart"><PackageSearch size={36} aria-hidden="true" /><h2>Todavía no tienes pedidos</h2><p>Aquí aparecen, con su estado, los pedidos que haces con tu cuenta y los que hiciste sin cuenta con este correo.</p><Link to="/catalogo" className="btn btn-primary">Ver catálogo</Link></div>
        : <p className="muted">No hay pedidos en este filtro.</p>)}
      <ul className="orders-history customer-orders">{orders.map(order => <OrderCard key={order.orderNumber} order={order} />)}</ul>
      {moreError && <p className="notice notice-error" role="alert">{moreError}</p>}
      {hasMore && <button type="button" className="btn btn-outline btn-block" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Cargando…" : "Cargar más pedidos"}</button>}

      <section className="orders-add" aria-labelledby="orders-add-title">
        <h2 id="orders-add-title">¿Compraste sin cuenta?</h2>
        <p className="muted">Agrega el pedido con su número. Debe estar hecho con el correo de esta cuenta ({email}).</p>
        <form className="orders-add-form" onSubmit={add}>
          <label className="field"><span>Número de pedido</span><input value={typed} onChange={event => setTyped(event.target.value)} placeholder="RE-260929-AB12C" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={30} aria-describedby={added ? "orders-add-result" : undefined} aria-invalid={added && !added.ok ? true : undefined} /></label>
          <button className="btn btn-outline" disabled={adding}>{adding ? "Buscando…" : "Agregar pedido"}</button>
        </form>
        {added && <p id="orders-add-result" className={`notice ${added.ok ? "notice-success" : "notice-error"}`} role={added.ok ? "status" : "alert"}>{added.text}</p>}
      </section>
    </>
  );
}

type CancelResult = { cancelMyOrder: { alreadyCancelled: boolean; accountBlocked: boolean; order: CustomerOrder } };
const reasons: Array<[string, string]> = [["CHANGED_MIND", "Cambié de opinión"], ["WRONG_PRODUCT", "Me equivoqué de producto o presentación"], ["DELAY", "Ya no lo necesito a tiempo"], ["OTHER", "Otro motivo"]];

/** CU12: pedir al equipo la cancelación de un pedido que ya no se cancela directamente. */
function RequestCancellation({ order, onDone, compact = false }: { order: CustomerOrder; onDone: (message: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(compact);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [request, state] = useMutation(REQUEST_ORDER_CANCELLATION);
  const submit = async () => {
    if (!reason) { setError("Elige el motivo."); document.getElementById("request-reason")?.focus(); return; }
    setError("");
    try { await request({ variables: { number: order.orderNumber, reason, note: note.trim() } }); onDone("Recibimos tu solicitud de cancelación. Nuestro equipo la revisa y te avisa aquí."); }
    catch (caught) { setError(friendlyError(caught, "No pudimos enviar la solicitud. Vuelve a intentarlo.")); }
  };
  if (!open) return <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>Solicitar cancelación</button>;
  return (
    <div className="request-cancel" role="group" aria-label="Solicitar cancelación">
      {!compact && <p>La cancelación de este pedido la revisa nuestro equipo. {order.paidAt ? "Si corresponde, el reembolso se coordina contigo." : ""}</p>}
      <label className="field" htmlFor="request-reason"><span>Motivo</span>
        <select id="request-reason" value={reason} aria-invalid={error && !reason ? true : undefined} onChange={event => { setReason(event.target.value); setError(""); }}>
          <option value="" disabled>Elige el motivo</option>
          {reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="field" htmlFor="request-note"><span>Comentario (opcional)</span><input id="request-note" maxLength={300} value={note} onChange={event => setNote(event.target.value)} /></label>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <div className="account-form-actions">
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={state.loading}>{state.loading ? "Enviando…" : "Enviar solicitud"}</button>
        {!compact && <button type="button" className="btn btn-outline" onClick={() => { setOpen(false); setError(""); }}>No, conservarlo</button>}
      </div>
    </div>
  );
}

/**
 * CU11: confirmación de la cancelación directa. Muestra pedido, productos y consecuencias; en transferencia
 * pregunta si ya se envió el comprobante (si sí, la cancelación la revisa el equipo); avisa si bloquearía la cuenta.
 */
function CancelOrder({ order, whatsapp, onDone, onBlocked }: { order: CustomerOrder; whatsapp?: string | null; onDone: (message: string) => void; onBlocked: () => void }) {
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState<"" | "yes" | "no">("");
  const [error, setError] = useState("");
  const [cancel, state] = useMutation<CancelResult>(CANCEL_MY_ORDER);
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const transfer = order.paymentMethod === "BANK_TRANSFER";
  useEffect(() => { if (open) confirmRef.current?.focus(); }, [open]);
  const close = () => { setOpen(false); setProof(""); setError(""); requestAnimationFrame(() => openButton.current?.focus()); };
  const submit = async () => {
    setError("");
    try {
      const { data } = await cancel({ variables: { number: order.orderNumber } });
      if (data?.cancelMyOrder.accountBlocked) { onBlocked(); return; }
      onDone(data?.cancelMyOrder.alreadyCancelled ? "Este pedido ya estaba cancelado." : "Pedido cancelado. Los productos volvieron al catálogo.");
    } catch (caught) { setError(friendlyError(caught, "No pudimos cancelar el pedido. Vuelve a intentarlo.")); }
  };
  if (!open) return <button type="button" ref={openButton} className="btn btn-outline" onClick={() => setOpen(true)}>Cancelar pedido</button>;
  const units = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <section className="remove-confirm" role="group" aria-labelledby="cancel-title">
      <h3 id="cancel-title" ref={confirmRef} tabIndex={-1}>¿Cancelar el pedido {order.orderNumber}?</h3>
      <p>{units} {units === 1 ? "producto" : "productos"} por {formatMoney(order.total)}. Los productos vuelven al catálogo{order.discount ? " y tu código de descuento vuelve a estar disponible" : ""}. No se te cobra nada.</p>
      {transfer && <fieldset className="plain-fieldset">
        <legend>¿Ya enviaste tu comprobante de transferencia?</legend>
        <label className="choice"><input type="radio" name="proof" checked={proof === "no"} onChange={() => setProof("no")} /><span><b>No, todavía no</b></span></label>
        <label className="choice"><input type="radio" name="proof" checked={proof === "yes"} onChange={() => setProof("yes")} /><span><b>Sí, ya lo envié</b></span></label>
      </fieldset>}
      {proof === "yes" && <>
        <p className="notice" role="status">Si ya transferiste, la cancelación y la devolución del dinero las revisa nuestro equipo: envíanos la solicitud.</p>
        <RequestCancellation order={order} compact onDone={onDone} />
      </>}
      {order.cancellation.blocksAccount && <p className="notice notice-error" role="alert">Sería tu tercera cancelación seguida: si continúas, tu cuenta se bloqueará por seguridad y tendrás que escribirnos para reactivarla.</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <div className="account-form-actions">
        <button type="button" className="btn btn-danger" onClick={() => void submit()} disabled={state.loading || (transfer && proof !== "no")}>{state.loading ? "Cancelando…" : "Sí, cancelar pedido"}</button>
        <button type="button" className="btn btn-outline" onClick={close}>No, conservarlo</button>
      </div>
    </section>
  );
}

function OrderDetail({ number, onBlocked }: { number: string; onBlocked: () => void }) {
  const { data, loading, error, refetch } = useQuery<{ myOrder: CustomerOrder | null }>(MY_ORDER, { variables: { number }, fetchPolicy: "cache-and-network" });
  const { data: info } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const order = data?.myOrder;
  const active = Boolean(order && !FINAL.includes(order.status));
  const { updatedAt, setUpdatedAt, stale, busy, refresh } = useRefresh(refetch, active);
  useEffect(() => { if (order) setUpdatedAt(current => current ?? new Date()); }, [order, setUpdatedAt]);
  // Solo se anuncia un cambio de estado, no toda la línea de tiempo en cada consulta.
  const previous = useRef<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [cancelled, setCancelled] = useState("");
  useEffect(() => {
    if (!order) return;
    const label = statusLabel(order.status, order.paymentMethod, confirmed(order));
    if (previous.current && previous.current !== label) setAnnounce(`El estado de tu pedido cambió: ${label}.`);
    previous.current = label;
  }, [order]);

  if (loading && data === undefined) return <p className="muted loading-line" role="status">Cargando el pedido…</p>;
  if (error && !order) return <div className="notice notice-error" role="alert"><span>{friendlyError(error, "No pudimos traer el pedido.")}</span><button type="button" className="btn btn-outline btn-sm" onClick={() => void refresh()}>Reintentar</button></div>;
  if (!order) return <div className="empty-cart"><PackageSearch size={36} aria-hidden="true" /><h2>No encontramos ese pedido en tu cuenta</h2><p>Revisa el número o agrégalo desde Mis pedidos si lo hiciste sin cuenta con este correo.</p><Link to="/mis-pedidos" className="btn btn-outline">Ver todos mis pedidos</Link></div>;

  const cod = order.paymentMethod === "CASH_ON_DELIVERY";
  const whatsapp = info?.checkoutInfo.whatsapp;
  const hours = cod ? info?.checkoutInfo.cashOnDelivery.confirmHours ?? 4 : info?.checkoutInfo.reservationHours ?? 24;
  const deadline = order.status === "PENDING_PAYMENT" && (!cod || !confirmed(order)) ? ecuadorDateTime(new Date(Date.parse(order.createdAt) + hours * 3600000).toISOString()) : null;
  const closed = order.status === "CANCELLED" || order.status === "RETURNED";
  return (
    <article className="order-detail" aria-labelledby="order-status-title">
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <header className="order-detail-head">
        <h2 id="order-status-title">{statusLabel(order.status, order.paymentMethod, confirmed(order))}</h2>
        <p className="muted">Registrado el {ecuadorDateTime(order.createdAt)} · {shippingLabels[order.shippingMethod]} · {paymentLabels[order.paymentMethod]}</p>
        <div className="orders-refresh">
          {updatedAt && <small className="muted">Actualizado a las {clock(updatedAt)}</small>}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void refresh()} disabled={busy}><RefreshCw size={16} aria-hidden="true" /> {busy ? "Actualizando…" : "Actualizar"}</button>
        </div>
        {stale && <p className="notice" role="status">No pudimos actualizar; mostramos los datos de la última consulta.</p>}
      </header>

      {closed
        ? <p className="notice notice-error reserve-note"><XCircle size={18} aria-hidden="true" /> {order.status === "CANCELLED" ? (order.events.find(e => e.status === "CANCELLED")?.note ?? "Este pedido fue cancelado y sus productos volvieron al catálogo.") : "Este pedido fue devuelto."}</p>
        : <OrderProgress status={order.status} paymentMethod={order.paymentMethod} confirmed={confirmed(order)} events={order.events} />}
      {deadline && <p className="notice reserve-note"><Clock3 size={18} aria-hidden="true" /><span>{cod ? `Confírmalo por WhatsApp antes del ${deadline}` : `Paga antes del ${deadline}`}; si no, el pedido se cancela automáticamente.</span></p>}
      {deadline && whatsapp && <a className="btn btn-primary btn-block" href={whatsappHref(whatsapp, `Hola RawEnergy, ${cod ? "confirmo" : "envío el comprobante de"} mi pedido ${order.orderNumber} por ${formatMoney(order.total)}.`)} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} aria-hidden="true" /> {cod ? "Confirmar por WhatsApp" : "Enviar comprobante por WhatsApp"}<span className="sr-only"> (se abre en otra pestaña)</span></a>}

      <section className="account-card" aria-labelledby="order-products">
        <h3 id="order-products">Productos</h3>
        <ul className="order-detail-items">
          {order.items.map(item => (
            <li key={item.variantSku}>
              <span aria-hidden="true"><Thumb src={item.image} /></span>
              <span><b>{item.title}</b><small className="muted">{item.variantLabel} · {item.quantity} × {formatMoney(item.unitPrice)}</small>{item.returnedQuantity > 0 && <small className="badge badge-warning">{item.returnedQuantity === item.quantity ? "Devuelto" : `${item.returnedQuantity} de ${item.quantity} devueltos`}</small>}</span>
              <strong>{formatMoney(item.lineTotal)}</strong>
            </li>
          ))}
        </ul>
        <div className="order-summary">
          <div><span>Subtotal</span><span>{formatMoney(order.subtotal)}</span></div>
          {order.discount && <div className="summary-discount"><span>Descuento {order.discount.code} ({order.discount.percent} %)</span><span>−{formatMoney(order.discount.amount)}</span></div>}
          <div><span>Envío</span><span>{order.shippingFee > 0 ? formatMoney(order.shippingFee) : "Gratis"}</span></div>
          <div className="order-summary-total"><b>Total</b><strong>{formatMoney(order.total)}</strong></div>
        </div>
      </section>

      <section className="account-card" aria-labelledby="order-delivery">
        <h3 id="order-delivery">Entrega y factura</h3>
        <dl className="account-data">
          <div><dt>Dirección</dt><dd>{order.delivery.address}, {order.delivery.city}, {order.delivery.province}{order.delivery.reference && <><br /><small className="muted">Referencia: {order.delivery.reference}</small></>}</dd></div>
          <div><dt>Recibe</dt><dd>{order.recipient.sameAsBuyer ? "Tú" : `${order.recipient.name} · ${order.recipient.phone}`}</dd></div>
          <div><dt>Factura a nombre de</dt><dd>{order.invoice.name}{order.invoice.idNumber && <> · {order.invoice.idNumber}</>}</dd></div>
          <div><dt>Pago</dt><dd>{paymentLabels[order.paymentMethod]} · {paymentSituation(order)}</dd></div>
        </dl>
      </section>

      {cancelled && <p className="notice notice-success" role="status">{cancelled}</p>}
      {order.cancellationRequest?.status === "PENDING" && <p className="notice" role="status">Tu solicitud de cancelación está en revisión (enviada el {ecuadorDateTime(order.cancellationRequest.createdAt)}).</p>}
      {order.cancellationRequest?.status === "REJECTED" && <p className="notice notice-error">No pudimos cancelar tu pedido: {order.cancellationRequest.publicNote}</p>}
      {order.cancellationRequest?.status === "APPROVED" && order.cancellationRequest.publicNote && <p className="notice">{order.cancellationRequest.publicNote}</p>}
      {order.cancellation.canCancel && <CancelOrder order={order} whatsapp={whatsapp} onBlocked={onBlocked} onDone={message => { setCancelled(message); void refresh(); }} />}
      {order.cancellation.canRequestCancellation && <RequestCancellation order={order} onDone={message => { setCancelled(message); void refresh(); }} />}
      {order.cancellation.reason && !closed && <p className="muted">{order.cancellation.reason}</p>}
      {whatsapp && <p className="field-help"><a href={whatsappHref(whatsapp, `Hola RawEnergy, tengo una consulta sobre mi pedido ${order.orderNumber}.`)} target="_blank" rel="noopener noreferrer">¿Necesitas ayuda con este pedido? Escríbenos por WhatsApp<span className="sr-only"> (se abre en otra pestaña)</span></a></p>}
    </article>
  );
}

/**
 * CU05/CU10: «Mis pedidos» como página propia y detalle por número. Solo pedidos de la cuenta con sesión:
 * el número de la dirección no da acceso a nada.
 */
export function OrdersPage({ email, number, onBlocked }: { email: string; number?: string; onBlocked: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  usePageEntry(number ? `Pedido ${number}` : "Mis pedidos", heading);
  return (
    <div className="container account-page">
      {number && <Link to="/mis-pedidos" className="btn-link back-link"><ArrowLeft size={18} aria-hidden="true" /> Mis pedidos</Link>}
      <h1 ref={heading} tabIndex={-1}>{number ? `Pedido ${number}` : "Mis pedidos"}</h1>
      {number ? <OrderDetail number={number} onBlocked={onBlocked} /> : <OrdersList email={email} />}
    </div>
  );
}
