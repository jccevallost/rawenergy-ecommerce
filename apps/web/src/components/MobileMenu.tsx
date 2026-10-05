import { useEffect, type MouseEvent } from "react";
import { useQuery } from "@apollo/client";
import { ChevronRight, CircleHelp, LayoutGrid, LogOut, MessageCircle, Package, PackageSearch, Tag, Truck, X } from "lucide-react";
import { type AuthUser, CHECKOUT_INFO, type CheckoutInfo } from "@vital-forge/shared-logic";
import { catalogHref } from "../lib/catalogUrl";
import { freeShippingText } from "../lib/commerceText";
import { goals } from "../lib/goals";
import { navigate, useRoute } from "../lib/router";
import { useModalA11y } from "../lib/useModalA11y";
import { whatsappHref } from "../lib/whatsapp";
import type { AuthMode } from "./AuthDialog";

type Props = { open: boolean; user: AuthUser | null; onClose: () => void; onLogin: (mode: AuthMode) => void; onOrders: () => void; onLogout: () => void };

const shop = [
  { to: catalogHref(), label: "Todo el catálogo", icon: LayoutGrid },
  ...goals.map(goal => ({ to: catalogHref({ goals: [goal.slug] }), label: goal.label, icon: goal.icon })),
  { to: "/#marcas", label: "Marcas", icon: Tag }
];
const help = [
  { to: "/pedido", label: "Consultar mi pedido", icon: PackageSearch },
  { to: "/#envios", label: "Envíos y pagos", icon: Truck },
  { to: "/legal/devoluciones", label: "Cambios y devoluciones", icon: CircleHelp }
];
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();

/**
 * Menú de móvil y tableta (C42): panel lateral sobre la página, con su propio
 * desplazamiento para que nada quede cortado en pantallas bajas. Retiene el foco,
 * se cierra con Escape, con el fondo o al elegir una opción, y vuelve inerte la tienda.
 */
export function MobileMenu({ open, user, onClose, onLogin, onOrders, onLogout }: Props) {
  const { href } = useRoute();
  const { dialogRef, headingRef } = useModalA11y<HTMLDivElement, HTMLHeadingElement>(onClose, open);
  const { data } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const whatsapp = data?.checkoutInfo.whatsapp;
  const freeShipping = data ? freeShippingText(data.checkoutInfo, true) : null;

  // Si la ventana crece hasta el menú de escritorio, el panel ya no tiene sentido.
  useEffect(() => {
    if (!open) return;
    const wide = matchMedia("(min-width: 901px)");
    const close = () => { if (wide.matches) onClose(); };
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, [open, onClose]);

  // Primero se cierra (la tienda deja de estar inerte) y luego se navega, para que
  // la página nueva pueda llevar el foco a su título.
  const go = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onClose();
    setTimeout(() => navigate(to), 0);
  };
  const act = (work: () => void) => () => { onClose(); setTimeout(work, 0); };
  const current = (to: string) => to === href ? "page" as const : undefined;

  return (
    <div className={`mobile-menu-layer ${open ? "is-open" : ""}`} aria-hidden={!open} inert={!open}>
      <div className="mobile-menu-backdrop" onClick={onClose} />
      <div id="menu-movil" className="mobile-menu" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="menu-movil-titulo">
        <div className="mobile-menu-head">
          <h2 id="menu-movil-titulo" ref={headingRef} tabIndex={-1}>Menú</h2>
          <button type="button" className="icon-btn icon-btn-dark" onClick={onClose} aria-label="Cerrar menú"><X size={22} /></button>
        </div>

        <div className="mobile-menu-body">
          <section className="mm-account" aria-label="Tu cuenta">
            {user ? (
              <>
                <div className="mm-user">
                  <span className="mm-avatar" aria-hidden="true">{initials(user.name) || "?"}</span>
                  <span><b>Hola, {user.name.split(" ")[0]}</b><small>{user.email}</small></span>
                </div>
                <button type="button" className="mm-link" onClick={act(onOrders)}><Package size={20} aria-hidden="true" /><span>Mis pedidos</span><ChevronRight size={18} aria-hidden="true" /></button>
              </>
            ) : (
              <>
                <p>Entra para ver tus pedidos y su estado.</p>
                <div className="mm-auth">
                  <button type="button" className="btn btn-primary" onClick={act(() => onLogin("login"))}>Entrar</button>
                  <button type="button" className="btn btn-outline-dark" onClick={act(() => onLogin("register"))}>Crear cuenta</button>
                </div>
              </>
            )}
          </section>

          <nav aria-labelledby="mm-comprar">
            <h3 id="mm-comprar" className="mm-title">Comprar</h3>
            <ul>
              {shop.map(({ to, label, icon: Icon }) => (
                <li key={to}><a className="mm-link" href={to} aria-current={current(to)} onClick={go(to)}><Icon size={20} aria-hidden="true" /><span>{label}</span><ChevronRight size={18} aria-hidden="true" /></a></li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="mm-ayuda">
            <h3 id="mm-ayuda" className="mm-title">Ayuda</h3>
            <ul>
              {help.map(({ to, label, icon: Icon }) => (
                <li key={to}><a className="mm-link" href={to} aria-current={current(to)} onClick={go(to)}><Icon size={20} aria-hidden="true" /><span>{label}</span><ChevronRight size={18} aria-hidden="true" /></a></li>
              ))}
              {whatsapp && <li><a className="mm-link" href={whatsappHref(whatsapp, "Hola RawEnergy, tengo una consulta.")} target="_blank" rel="noopener noreferrer"><MessageCircle size={20} aria-hidden="true" /><span>Escríbenos por WhatsApp<span className="sr-only"> (se abre en otra pestaña)</span></span><ChevronRight size={18} aria-hidden="true" /></a></li>}
            </ul>
          </nav>

          {user && <button type="button" className="mm-link mm-logout" onClick={act(onLogout)}><LogOut size={20} aria-hidden="true" /><span>Cerrar sesión</span></button>}
        </div>

        {freeShipping && <p className="mobile-menu-foot">{freeShipping}</p>}
      </div>
    </div>
  );
}
