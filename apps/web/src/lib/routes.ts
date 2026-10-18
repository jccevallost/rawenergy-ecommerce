// Rutas de la tienda sin dependencias del navegador, para poder probarlas (CU05).
export type Route =
  | { name: "home" }
  | { name: "catalog"; search: URLSearchParams }
  | { name: "product"; slug: string }
  | { name: "campaign"; slug: string }
  | { name: "track"; search: URLSearchParams }
  | { name: "legal"; topic: LegalTopic }
  // CU05: secciones privadas del cliente. La ruta es el destino tras entrar: no hay parámetro de redirección.
  | { name: "account"; section: AccountSection }
  | { name: "orders" }
  | { name: "orderDetail"; number: string }
  | { name: "notFound" };

export type AccountSection = "perfil" | "direcciones" | "seguridad";

export type LegalTopic = "terminos" | "privacidad" | "devoluciones" | "envios";

export const parse = (url: URL): Route => {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "home" };
  if (path === "/catalogo") return { name: "catalog", search: new URLSearchParams(url.search) };
  if (path === "/pedido") return { name: "track", search: new URLSearchParams(url.search) };
  if (path === "/cuenta") return { name: "account", section: "perfil" };
  if (path === "/cuenta/direcciones") return { name: "account", section: "direcciones" };
  if (path === "/cuenta/seguridad") return { name: "account", section: "seguridad" };
  if (path === "/mis-pedidos") return { name: "orders" };
  const order = /^\/mis-pedidos\/(RE-\d{6}-[A-Z0-9]{3,10})$/i.exec(path);
  if (order) return { name: "orderDetail", number: order[1]!.toUpperCase() };
  const legal = /^\/legal\/(terminos|privacidad|devoluciones|envios)$/.exec(path);
  if (legal) return { name: "legal", topic: legal[1] as LegalTopic };
  const product = /^\/producto\/([a-z0-9-]{1,160})$/.exec(path);
  if (product) return { name: "product", slug: product[1]! };
  const campaign = /^\/campana\/([a-z0-9-]{1,60})$/.exec(path);
  return campaign ? { name: "campaign", slug: campaign[1]! } : { name: "notFound" };
};

