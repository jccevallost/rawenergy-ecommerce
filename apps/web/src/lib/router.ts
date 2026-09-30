import { type AnchorHTMLAttributes, type MouseEvent, createElement, useEffect, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

// Enrutador minimo con la API de historial: la tienda cambia de vista sin recargar,
// y Atras/Adelante, recargar y compartir el enlace funcionan como en cualquier web.
// Netlify y `vite preview` devuelven index.html para estas rutas (appType "spa").
export type Route =
  | { name: "home" }
  | { name: "catalog"; search: URLSearchParams }
  | { name: "product"; slug: string }
  | { name: "campaign"; slug: string }
  | { name: "track"; search: URLSearchParams }
  | { name: "legal"; topic: LegalTopic }
  | { name: "notFound" };

export type LegalTopic = "terminos" | "privacidad" | "devoluciones" | "envios";
type RouteState = { route: Route; href: string; navigations: number; moveFocus: boolean };

const parse = (url: URL): Route => {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "home" };
  if (path === "/catalogo") return { name: "catalog", search: new URLSearchParams(url.search) };
  if (path === "/pedido") return { name: "track", search: new URLSearchParams(url.search) };
  const legal = /^\/legal\/(terminos|privacidad|devoluciones|envios)$/.exec(path);
  if (legal) return { name: "legal", topic: legal[1] as LegalTopic };
  const product = /^\/producto\/([a-z0-9-]{1,160})$/.exec(path);
  if (product) return { name: "product", slug: product[1]! };
  const campaign = /^\/campana\/([a-z0-9-]{1,60})$/.exec(path);
  return campaign ? { name: "campaign", slug: campaign[1]! } : { name: "notFound" };
};

const hrefOf = (url: URL) => `${url.pathname}${url.search}`;
const initialUrl = new URL(window.location.href);
let state: RouteState = { route: parse(initialUrl), href: hrefOf(initialUrl), navigations: 0, moveFocus: false };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const setState = (url: URL, moveFocus: boolean) => {
  state = { route: parse(url), href: hrefOf(url), navigations: state.navigations + 1, moveFocus };
  listeners.forEach(listener => listener());
};

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
type TransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

/** Aplica el cambio dentro de una transición de vista si el navegador la admite. */
function commit(update: () => void, animate: boolean) {
  const doc = document as TransitionDocument;
  if (animate && doc.startViewTransition && !prefersReducedMotion()) doc.startViewTransition(() => flushSync(update));
  else update();
}

if ("scrollRestoration" in history) history.scrollRestoration = "manual";

export type NavigateOptions = {
  /** Reemplaza la entrada actual: para ajustes de filtros que no merecen un «Atrás» propio. */
  replace?: boolean;
  /** Mantiene el desplazamiento y el foco: el usuario sigue en la misma vista. */
  keepScroll?: boolean;
};

/** Lleva a una sección (`/#envios`) y le pasa el foco para que teclado y lector continúen ahí. */
function revealSection(hash: string) {
  const target = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!target) return false;
  target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  return true;
}

export function navigate(to: string, { replace = false, keepScroll = false }: NavigateOptions = {}) {
  const url = new URL(to, window.location.href);
  if (url.origin !== window.location.origin) { window.location.assign(url); return; }
  if (hrefOf(url) === state.href) {
    if (url.hash) revealSection(url.hash);
    else if (!keepScroll) window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    return;
  }
  // Guarda dónde estaba la persona para devolverla ahí con «Atrás».
  history.replaceState({ ...(history.state ?? {}), scrollY: window.scrollY }, "");
  const samePage = parse(url).name === state.route.name;
  commit(() => {
    history[replace ? "replaceState" : "pushState"]({ scrollY: 0 }, "", url);
    setState(url, !keepScroll && !url.hash);
    if (url.hash) requestAnimationFrame(() => { if (!revealSection(url.hash)) window.scrollTo(0, 0); });
    else if (!keepScroll) window.scrollTo(0, 0);
  }, !(samePage && keepScroll));
}

window.addEventListener("popstate", event => {
  const url = new URL(window.location.href);
  // Los enlaces de salto (#contenido) también disparan popstate: no es otra vista.
  if (hrefOf(url) === state.href) return;
  const scrollY = Number((event.state as { scrollY?: unknown } | null)?.scrollY) || 0;
  commit(() => {
    setState(url, true);
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }, true);
});

export const useRoute = () => useSyncExternalStore(subscribe, () => state);

/**
 * Título del documento y foco en el encabezado principal al cambiar de vista,
 * para que lectores de pantalla anuncien la página nueva. No se mueve el foco
 * en la carga inicial ni cuando solo cambian filtros.
 */
export function usePageEntry(title: string, heading: { current: HTMLElement | null }) {
  const { navigations, moveFocus } = useRoute();
  useEffect(() => { document.title = title ? `${title} · RawEnergy EC` : "RawEnergy EC — Suplementos deportivos"; }, [title]);
  useEffect(() => {
    if (navigations > 0 && moveFocus) heading.current?.focus({ preventScroll: true });
  }, [navigations, moveFocus, heading]);
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string } & NavigateOptions;

/** Enlace real (se puede abrir en otra pestaña o copiar) que navega sin recargar. */
export function Link({ to, replace, keepScroll, onClick, ...props }: LinkProps) {
  return createElement("a", {
    ...props,
    href: to,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target) return;
      event.preventDefault();
      navigate(to, { replace, keepScroll });
    }
  });
}
