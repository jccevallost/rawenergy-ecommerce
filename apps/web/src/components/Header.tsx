import { useEffect, useRef, useState } from "react";
import { useQuery } from "@apollo/client";
import { ChevronDown, LogOut, Menu, Package, ShoppingBag, UserRound } from "lucide-react";
import { type AuthUser, CHECKOUT_INFO, type CheckoutInfo, useCartOrchestrator } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { AssetImage } from "./AssetImage";
import { SearchBox } from "./SearchBox";
import { siteLogoCandidates } from "../lib/assetCatalog";
import { catalogHref, filtersFromSearch } from "../lib/catalogUrl";
import { goals } from "../lib/goals";
import { Link, useRoute } from "../lib/router";
import { freeShippingText } from "../lib/commerceText";
import { EXPRESS_PROMISE_SHORT } from "../lib/storePromises";

export function SiteLogo() {
  return (
    <Link to="/" className="site-logo" aria-label="RawEnergy EC, ir al inicio">
      <AssetImage className="site-logo-img" candidates={siteLogoCandidates()} alt="" loading="eager"
        fallback={<span className="logo-text">RAW<b>ENERGY</b> <small>EC</small></span>} />
    </Link>
  );
}

const shopLinks = [
  { to: catalogHref(), label: "Todo el catálogo" },
  ...goals.map(goal => ({ to: catalogHref({ goals: [goal.slug] }), label: goal.label })),
  { to: "/#marcas", label: "Marcas" },
  { to: "/#envios", label: "Envíos y pagos" }
];

type HeaderProps = { user: AuthUser | null; menuOpen: boolean; onMenu: () => void; onLogin: () => void; onLogout: () => void };

export const accountLinks = [
  { to: "/cuenta", label: "Mi cuenta" },
  { to: "/cuenta/direcciones", label: "Direcciones" },
  { to: "/mis-pedidos", label: "Mis pedidos" }
];

/**
 * CU05: menú de la cuenta como desplegable con enlaces reales (patrón de divulgación, sin role="menu"):
 * se abre con el botón, se cierra con Escape, al tocar fuera o al navegar, y devuelve el foco al botón.
 */
function AccountMenu({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { href } = useRoute();
  useEffect(() => setOpen(false), [href]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    const leave = (event: FocusEvent) => { if (event.relatedTarget && !box.current?.contains(event.relatedTarget as Node)) setOpen(false); };
    const current = box.current;
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    current?.addEventListener("focusout", leave);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); current?.removeEventListener("focusout", leave); };
  }, [open]);
  const path = href.split("?")[0];
  return (
    <div className="account-menu" ref={box}>
      {/* En móvil el texto se oculta: el nombre accesible lo repite e incluye lo visible en escritorio. */}
      <button type="button" ref={button} className="header-action" aria-label={`Hola, ${user.name.split(" ")[0]}. Mi cuenta`} aria-expanded={open} aria-controls="menu-cuenta" onClick={() => setOpen(value => !value)}>
        <UserRound size={22} aria-hidden="true" />
        <span className="header-action-text"><small>Hola, {user.name.split(" ")[0]}</small>Mi cuenta</span>
        <ChevronDown size={16} aria-hidden="true" className="account-menu-chevron" />
      </button>
      <ul id="menu-cuenta" className="account-menu-list" hidden={!open}>
        {accountLinks.map(link => <li key={link.to}><Link to={link.to} aria-current={path === link.to ? "page" : undefined}>{link.label}</Link></li>)}
        <li><button type="button" onClick={() => { setOpen(false); onLogout(); }}><LogOut size={18} aria-hidden="true" />Cerrar sesión</button></li>
      </ul>
    </div>
  );
}

export function Header({ user, menuOpen, onMenu, onLogin, onLogout }: HeaderProps) {
  const { route, href } = useRoute();
  const { itemCount, toggleCart } = useCartOrchestrator();
  const { data } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const freeShipping = data ? freeShippingText(data.checkoutInfo, true) : null;
  const welcome = data?.checkoutInfo.welcomeDiscount;
  const currentQuery = route.name === "catalog" ? filtersFromSearch(route.search).search ?? "" : "";

  // Móvil y tableta (C54): la cabecera se oculta al bajar y vuelve al subir. Nunca se
  // oculta cerca del inicio ni con el foco dentro (búsqueda, menú, carrito).
  const headerRef = useRef<HTMLElement>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const small = matchMedia("(max-width: 900px)");
    let last = window.scrollY, frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY, delta = y - last;
        last = y;
        if (!small.matches || y < 160 || headerRef.current?.contains(document.activeElement)) { setHidden(false); return; }
        if (delta > 6) setHidden(true);
        else if (delta < -6) setHidden(false);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
  }, []);
  useEffect(() => setHidden(false), [href]);


  return (
    <header className={`site-header ${hidden ? "is-hidden" : ""}`} ref={headerRef} onFocusCapture={() => setHidden(false)}>
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <a className="skip-link" href="#buscar">Ir a la búsqueda</a>
      <p className="promo-strip">
        {welcome?.code && <span>{welcome.percent} % en tu primera compra: <b>{welcome.code}</b></span>}
        {/* Una sola mención del express (C63): con envío gratis solo en express, ambas cosas van juntas. */}
        {data?.checkoutInfo.freeShippingMethods.length === 1 && data.checkoutInfo.freeShippingMethods[0] === "EXPRESS_QUITO_VALLES"
          ? <span>{EXPRESS_PROMISE_SHORT}, gratis desde {formatMoney(data.checkoutInfo.freeShippingThreshold)}</span>
          : <><span>{freeShipping ?? "Envío calculado antes de confirmar"}</span><span>{EXPRESS_PROMISE_SHORT}</span></>}
        <span>Compra sin crear cuenta</span>
      </p>
      <div className="header-bar container">
        {/* En móvil y tableta abre el panel lateral (MobileMenu, C42); en escritorio el menú va en la barra de abajo. */}
        <button type="button" className="icon-btn icon-btn-dark menu-toggle" aria-expanded={menuOpen} aria-controls="menu-movil" aria-haspopup="dialog" onClick={onMenu} aria-label="Abrir menú">
          <Menu size={22} />
        </button>
        <SiteLogo />
        <SearchBox initial={currentQuery} />
        <div className="header-actions">
          {user ? (
            <AccountMenu user={user} onLogout={onLogout} />
          ) : data?.checkoutInfo.customerAccounts ? (
            <button type="button" className="header-action" onClick={onLogin} aria-label="Entrar a mi cuenta">
              <UserRound size={22} aria-hidden="true" />
              <span className="header-action-text"><small>Mi cuenta</small>Entrar</span>
            </button>
          ) : (
            <Link to="/pedido" className="header-action" aria-label="Consulta tu pedido">
              <Package size={22} aria-hidden="true" />
              <span className="header-action-text"><small>Tu pedido</small>Consultar</span>
            </Link>
          )}
          <button type="button" className="header-action cart-button" onClick={() => toggleCart(true)} aria-label={`Carrito, ${itemCount} ${itemCount === 1 ? "producto" : "productos"}`}>
            <span className="cart-icon"><ShoppingBag size={22} aria-hidden="true" /><b aria-hidden="true">{itemCount}</b></span>
            <span className="header-action-text"><small>Tu compra</small>Carrito</span>
          </button>
        </div>
      </div>
      <nav id="menu-tienda" className="shop-nav" aria-label="Secciones de la tienda">
        <ul className="container">
          {shopLinks.map(link => {
            const current = link.to === href;
            return <li key={link.to}><Link to={link.to} aria-current={current ? "page" : undefined}>{link.label}</Link></li>;
          })}
        </ul>
      </nav>
    </header>
  );
}
