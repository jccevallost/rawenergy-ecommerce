import { useQuery } from "@apollo/client";
import { Check, Truck } from "lucide-react";
import { CHECKOUT_INFO, type CheckoutInfo, type ShippingMethod, useCartOrchestrator } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";

/** Texto del envío gratis según los métodos que lo tienen (hoy: solo express en Quito y Valles). */
export function freeShippingLabel(methods: ShippingMethod[]) {
  if (methods.length > 1) return "el envío gratis";
  return methods[0] === "EXPRESS_QUITO_VALLES" ? "el envío express gratis en Quito y Valles" : "el envío nacional gratis";
}

/** `discount`: descuento de bienvenida aplicado (C46); el envío gratis se calcula con lo pagado por los productos, igual que el servidor. */
export function ShippingProgress({ method, discount = 0 }: { method?: ShippingMethod; discount?: number }) {
  const { data } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const info = data?.checkoutInfo;
  const { totals } = useCartOrchestrator(info?.freeShippingThreshold ?? 75);
  const methods = info?.freeShippingMethods ?? [];
  if (!info || !methods.length) return <div className="shipping-progress"><span>Verás el costo de envío antes de confirmar tu pedido.</span></div>;
  // Ya eligió un envío sin beneficio: se explica en lugar de prometer algo que no aplica.
  if (method && !methods.includes(method)) return <div className="shipping-progress"><span><Truck size={16} aria-hidden="true" /> Envío gratis solo con {methods.includes("EXPRESS_QUITO_VALLES") ? "express en Quito y Valles" : "el otro método"}, desde {formatMoney(info.freeShippingThreshold)}.</span></div>;
  const paid = Math.round((totals.subtotal - discount) * 100) / 100;
  const missing = Math.max(0, Math.round((info.freeShippingThreshold - paid) * 100) / 100);
  const progress = Math.min(100, (paid / info.freeShippingThreshold) * 100);
  return (
    <div className="shipping-progress">
      <div className="shipping-message">
        {missing === 0
          ? <><Check size={16} aria-hidden="true" /><span>{methods.length > 1 ? "Tu envío es gratis" : `Tienes ${freeShippingLabel(methods)}`}</span></>
          : <><Truck size={16} aria-hidden="true" /><span>Te faltan <b>{formatMoney(missing)}</b> para {freeShippingLabel(methods)}</span></>}
      </div>
      <div className="progress-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
    </div>
  );
}
