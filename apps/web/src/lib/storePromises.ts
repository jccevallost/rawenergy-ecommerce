import { Bike, ShieldCheck, Truck } from "lucide-react";

// Único lugar con promesas comerciales de plazo y origen, confirmadas por el
// propietario el 2026-09-26 (registro de auditoría, fase C). Cualquier cambio de
// plazo o garantía se confirma antes con el negocio. El umbral de envío gratis y
// las tarifas no van aquí: los entrega el servidor.
export const storePromises = [
  { icon: Bike, title: "Express Quito y Valles", detail: "Entrega en 4 horas en productos seleccionados." },
  { icon: Truck, title: "Envío nacional", detail: "Servientrega a todo el país en 24 a 48 horas." },
  { icon: ShieldCheck, title: "Producto original", detail: "Marcas reconocidas y producto sellado." }
] as const;
