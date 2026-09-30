import type { CheckoutInfo } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";

// Textos de envío gratis y contra entrega a partir de las reglas del panel,
// para que cabecera, portada, ficha y políticas digan lo mismo que el servidor.
type Rules = Pick<CheckoutInfo, "freeShippingThreshold" | "freeShippingMethods" | "cashOnDelivery">;

/** «Envío express gratis en Quito y Valles desde $75,00», o null si ningún envío es gratis. */
export function freeShippingText(info: Rules, short = false) {
  const methods = info.freeShippingMethods ?? [];
  if (!methods.length) return null;
  const from = formatMoney(info.freeShippingThreshold);
  if (methods.length > 1) return `Envío gratis desde ${from}`;
  if (methods[0] === "EXPRESS_QUITO_VALLES") return short ? `Express gratis desde ${from} en Quito y Valles` : `Envío express gratis en Quito y Valles desde ${from}`;
  return `Envío nacional gratis desde ${from}`;
}

/** «con envío express en Quito y Valles, sin monto mínimo». */
export function cashOnDeliveryConditions(info: Rules) {
  const cod = info.cashOnDelivery;
  const where = cod.expressOnly ? "con envío express en Quito y Valles" : "en todos los envíos";
  return `${where}, ${cod.minimumSubtotal > 0 ? `en compras de más de ${formatMoney(cod.minimumSubtotal)}` : "sin monto mínimo"}`;
}
