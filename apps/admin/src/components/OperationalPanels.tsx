import { useLeaveGuard } from "./common/UnsavedChanges";
import { useRef, useState } from "react";
import { OrderOperations } from "./OrderOperations";
import { Activity, CreditCard, Database, Mail, Package, Send, ShieldCheck, Truck, Search, Settings } from "lucide-react";
import { CommercePanel } from "../features/settings/CommercePanel";
import { NotificationsPanel } from "../features/settings/NotificationsPanel";
import { CashOnDeliveryConfirm } from "./CashOnDeliveryConfirm";
import { formatMoney } from "@vital-forge/ui-core";
import type { Order, OrderStatus, StoreSettings } from "@vital-forge/shared-logic";
type DataStatus = "ok" | "loading" | "error";
const ORDERS_PAGE_SIZE = 20;
const emptyCopy = (status: DataStatus, ok: string, loading: string, error: string) => status === "error" ? error : status === "loading" ? loading : ok;
const orderStatusLabels: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  PAYMENT_REVIEW: "Revisando comprobante",
  PAID: "Pago confirmado",
  PREPARING: "Preparando",
  SHIPPED: "Enviado",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado",
  RETURNED: "Devuelto"
};

const shippingLabels: Record<Order["shippingMethod"], string> = {
  EXPRESS_QUITO_VALLES: "Quito y Valles - express",
  SERVIENTREGA_NATIONAL: "Nacional por Servientrega"
};

export function OrdersPanel({ orders, total, status, search, page, dataStatus, onStatusFilter, onSearch, onPage, onStatus, readonly, onEdit, onHistory }: {
  readonly?: boolean;
  onEdit?: (order: Order) => void;
  onHistory?: (id: string) => void;
  orders: Order[];
  total: number;
  status: OrderStatus | "";
  search: string;
  page: number;
  dataStatus: DataStatus;
  onStatusFilter: (value: OrderStatus | "") => void;
  onSearch: (value: string) => void;
  onPage: (value: number) => void;
  onStatus: (id: string, status: OrderStatus) => void;
}) {
  const leave=useLeaveGuard();const changingView=useRef(false);const [viewVersion,setViewVersion]=useState(0);const [notice,setNotice]=useState("");
  const changeView=async(change:()=>void)=>{if(changingView.current)return;changingView.current=true;try{if(await leave()){setViewVersion(value=>value+1);change();}}finally{changingView.current=false;}};
  const from = total ? page * ORDERS_PAGE_SIZE + 1 : 0;
  const to = page * ORDERS_PAGE_SIZE + orders.length;
  const hasNext = page * ORDERS_PAGE_SIZE + orders.length < total;
  const filtered = Boolean(status || search);
  return (
    <section className="admin-section">
      <header>
        <div>
          <span className="kicker"><Activity /> Checkout manual</span>
          <h1>Pedidos</h1>
          <p>{emptyCopy(dataStatus, `${total} pedidos${filtered ? " con los filtros aplicados" : ""}. Confirma la transferencia y avanza el estado.`, "Cargando pedidos...", "No se pudieron cargar los pedidos.")}</p>
        </div>
      </header>

      {notice&&<p role="status" className="admin-notice">{notice}</p>}
      <div className="filter-bar">
        <label className="filter-search">
          <Search />
          <input value={search} onChange={(event) => {const value=event.target.value;void changeView(()=>onSearch(value));}} placeholder="Número de pedido, cliente, correo o teléfono…" aria-label="Buscar orden" />
        </label>
        <label className="filter-select">
          <span>Estado</span>
          <select value={status} onChange={(event) => {const value=event.target.value as OrderStatus | "";void changeView(()=>onStatusFilter(value));}}>
            <option value="">Todos</option>
            {Object.entries(orderStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        {filtered && <button className="filter-clear" onClick={() => void changeView(() => { onStatusFilter(""); onSearch(""); })}>Limpiar filtros</button>}
      </div>

      {!orders.length && (
        <div className="empty-state">
          {emptyCopy(
            dataStatus,
            filtered ? "Ningun pedido coincide con los filtros." : "Aún no hay pedidos registrados.",
            "Cargando pedidos...",
            "No se pudieron cargar los pedidos."
          )}
        </div>
      )}

      <div className="orders-list">
        {orders.map((order) => (
          <article className="order-card" key={order.id}>
            <header>
              <div><b>{order.orderNumber}</b><span>{order.customer.fullName} - {order.customer.phone}</span></div>
              <strong>{formatMoney(order.total)}</strong>
            </header>
            <p>{order.customer.city}, {order.customer.province} - {order.customer.address}{order.customer.idNumber ? ` · ${order.customer.idType === "PASAPORTE" ? "Pasaporte" : order.customer.idType === "RUC" ? "RUC" : "Cédula"} (factura): ${order.customer.idNumber}` : ""}</p>
            <small>{shippingLabels[order.shippingMethod]} · Envío {order.shippingFee > 0 ? formatMoney(order.shippingFee) : "gratis"} · {order.discount ? <b className="discount-badge">Descuento {order.discount.code}: −{formatMoney(order.discount.amount)}</b> : null}{order.discount ? " · " : null}{order.paymentMethod === "CASH_ON_DELIVERY" ? <b className="cod-badge">Contra entrega: cobrar al entregar</b> : "Transferencia"}</small>
            {order.paymentReference && <small>Comprobante: {order.paymentReference}</small>}
            <div className="order-items">
              {order.items.map((item) => <span key={`${order.id}-${item.variantSku}`}>{item.quantity}x {item.title} · {item.variantLabel}<small>SKU: {item.variantSku}</small></span>)}
            </div>
            <CashOnDeliveryConfirm order={order} readonly={readonly} />
            <label>
              <span>Estado</span>
              <select disabled={readonly || !order.allowedNextStatuses?.length} value={order.status} onChange={(event) => onStatus(order.id, event.target.value as OrderStatus)}>
                {[order.status, ...(order.allowedNextStatuses ?? [])].map(value => <option value={value} key={value}>{orderStatusLabels[value]}</option>)}
              </select>
            </label>
            <div className="row-actions">{!readonly && <button onClick={() => onEdit?.(order)}>Editar datos</button>}{onHistory && <button onClick={() => onHistory(order.id)}>Historial</button>}</div>
            <OrderOperations key={`${order.id}:${viewVersion}`} order={order} readonly={readonly} onNotice={setNotice}/>
          </article>
        ))}
      </div>

      {total > 0 && (
        <div className="pager">
          <span>Mostrando {from}-{to} de {total}</span>
          <div>
            <button disabled={page === 0} onClick={() => void changeView(()=>onPage(page - 1))}>Anteriores</button>
            <button disabled={!hasNext} onClick={() => void changeView(()=>onPage(page + 1))}>Siguientes</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function SettingsPanel({ settings, adminEmail, graphqlUrl, dataStatus }: {
  settings?: StoreSettings;
  adminEmail: string;
  graphqlUrl: string;
  dataStatus: DataStatus;
}) {
  const canales = [
    settings?.notifications.telegram.enabled ? "Telegram" : "",
    settings?.notifications.email.enabled ? "correo" : ""
  ].filter(Boolean);
  const notificaAlgunCanal = canales.length > 0;
  const avisoOperador = notificaAlgunCanal ? canales.join(" y ") : "Sin configurar";
  return (
    <section className="admin-section">
      <header>
        <div>
          <span className="kicker"><Settings /> Configuracion</span>
          <h1>Tienda y API</h1>
          <p>Reglas vigentes en el servidor. Pagos, cuenta bancaria y envíos se editan en «Pagos y envíos».</p>
        </div>
      </header>
      {!settings ? (
        <div className="empty-state">{emptyCopy(dataStatus, "Sin configuracion disponible.", "Cargando configuracion...", "No se pudo leer la configuracion del servidor.")}</div>
      ) : (
        <div className="settings-grid">
          <article>
            <span className="settings-label"><Database /> Persistencia</span>
            <b>{settings.persistence === "mongodb" ? "MongoDB" : "Memoria (demo)"}</b>
            <p>{settings.persistence === "mongodb"
              ? "Los cambios se guardan en la base y sobreviven a un reinicio."
              : "La API no encontro MONGODB_URI: todo lo que crees se pierde al reiniciar el servidor."}</p>
          </article>
          <article>
            <span className="settings-label"><Truck /> Envios</span>
            <b>{!settings.freeShippingMethods?.length ? "Sin envío gratis" : settings.freeShippingMethods.length > 1 ? `Gratis desde ${formatMoney(settings.freeShippingThreshold)}` : `${shippingLabels[settings.freeShippingMethods[0]!]} gratis desde ${formatMoney(settings.freeShippingThreshold)}`}</b>
            <ul>
              {settings.shippingRates.map((rate) => (
                <li key={rate.method}><span>{shippingLabels[rate.method]}</span><em>{formatMoney(rate.fee)}</em></li>
              ))}
            </ul>
          </article>
          <article>
            <span className="settings-label"><CreditCard /> Pagos</span>
            <b>{settings.paymentMethods.length} metodo{settings.paymentMethods.length === 1 ? "" : "s"}</b>
            <p>{settings.paymentMethods.map((method) => method === "BANK_TRANSFER" ? "Transferencia bancaria con comprobante" : "Contra entrega").join(", ")}. Edítalos abajo, en Pagos y envíos.</p>
          </article>
          <article className={settings.notifications.email.enabled ? "" : "settings-warn"}>
            <span className="settings-label"><Mail /> Correo</span>
            <b>{settings.notifications.email.enabled ? "Activo" : "Sin configurar"}</b>
            <p>{settings.notifications.email.enabled
              ? `Cada pedido nuevo avisa al cliente y a ${settings.notifications.email.operator}.`
              : "Falta la configuracion SMTP. El cliente no recibe confirmacion ni datos bancarios."}</p>
            {settings.notifications.email.enabled && !settings.notifications.email.bankDetailsReady && (
              <p className="settings-hint">Faltan los datos bancarios: el correo no puede incluirlos y hay que enviarlos aparte.</p>
            )}
          </article>
          <article className={notificaAlgunCanal ? "" : "settings-warn"}>
            <span className="settings-label"><Send /> Aviso al operador</span>
            <b>{avisoOperador}</b>
            <p>{notificaAlgunCanal
              ? "Cuando entra un pedido llega un aviso sin que nadie tenga que revisar el panel."
              : "Nadie recibe aviso cuando entra un pedido: hay que abrir el panel a mano para enterarse."}</p>
          </article>
          <article>
            <span className="settings-label"><ShieldCheck /> Sesión</span>
            <b>{adminEmail}</b>
            <p>Las mutaciones admin viajan con Authorization Bearer hacia {graphqlUrl}.</p>
          </article>
        </div>
      )}
      <NotificationsPanel />
      <CommercePanel />
    </section>
  );
}
