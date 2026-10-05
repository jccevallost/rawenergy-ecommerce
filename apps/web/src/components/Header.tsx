import { useEffect, useRef, useState } from "react";
import { useQuery } from "@apollo/client";
import { LogOut, Menu, ShoppingBag, UserRound } from "lucide-react";
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

type HeaderProps = { user: AuthUser | null; menuOpen: boolean; onMenu: () => void; onLogin: () => void; onOrders: () => void; onLogout: () => void };

export function Header({ user, menuOpen, onMenu, onLogin, onOrders, onLogout }: HeaderProps) {
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
            <>
              <button type="button" className="header-action" onClick={onOrders} aria-label="Mis pedidos">
                <UserRound size={22} aria-hidden="true" />
                <span className="header-action-text"><small>Hola, {user.name.split(" ")[0]}</small>Mis pedidos</span>
              </button>
              <button type="button" className="icon-btn icon-btn-dark header-desktop-only" onClick={onLogout} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut size={20} /></button>
            </>
          ) : (
            <button type="button" className="header-action" onClick={onLogin} aria-label="Entrar a mi cuenta">
              <UserRound size={22} aria-hidden="true" />
              <span className="header-action-text"><small>Mi cuenta</small>Entrar</span>
            </button>
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
