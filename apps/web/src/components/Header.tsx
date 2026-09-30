import { type FormEvent, useEffect, useState } from "react";
import { useQuery } from "@apollo/client";
import { LogOut, Menu, Search, ShoppingBag, UserRound } from "lucide-react";
import { type AuthUser, CHECKOUT_INFO, type CheckoutInfo, useCartOrchestrator } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { AssetImage } from "./AssetImage";
import { siteLogoCandidates } from "../lib/assetCatalog";
import { catalogHref, filtersFromSearch } from "../lib/catalogUrl";
import { goals } from "../lib/goals";
import { Link, navigate, useRoute } from "../lib/router";
import { freeShippingText } from "../lib/commerceText";

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

type HeaderProps = { user: AuthUser | null; adminUrl: string; menuOpen: boolean; onMenu: () => void; onLogin: () => void; onOrders: () => void; onLogout: () => void };

export function Header({ user, adminUrl, menuOpen, onMenu, onLogin, onOrders, onLogout }: HeaderProps) {
  const { route, href } = useRoute();
  const { itemCount, toggleCart } = useCartOrchestrator();
  const { data } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const freeShipping = data ? freeShippingText(data.checkoutInfo, true) : null;
  const welcome = data?.checkoutInfo.welcomeDiscount;
  const currentQuery = route.name === "catalog" ? filtersFromSearch(route.search).search ?? "" : "";
  const [query, setQuery] = useState(currentQuery);

  useEffect(() => setQuery(currentQuery), [currentQuery]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    navigate(catalogHref(text ? { search: text } : {}));
  };

  return (
    <header className="site-header">
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <a className="skip-link" href="#buscar">Ir a la búsqueda</a>
      <p className="promo-strip">
        {welcome?.code && <span>{welcome.percent} % en tu primera compra: <b>{welcome.code}</b></span>}
        <span>{freeShipping ?? "Envío calculado antes de confirmar"}</span>
        <span>Express 4 h en Quito y Valles</span>
        <span>Compra sin crear cuenta</span>
      </p>
      <div className="header-bar container">
        {/* En móvil y tableta abre el panel lateral (MobileMenu, C42); en escritorio el menú va en la barra de abajo. */}
        <button type="button" className="icon-btn icon-btn-dark menu-toggle" aria-expanded={menuOpen} aria-controls="menu-movil" aria-haspopup="dialog" onClick={onMenu} aria-label="Abrir menú">
          <Menu size={22} />
        </button>
        <SiteLogo />
        <form className="header-search" role="search" onSubmit={search}>
          <label className="sr-only" htmlFor="buscar">Buscar productos</label>
          <input id="buscar" type="search" enterKeyHint="search" autoComplete="off" maxLength={80} placeholder="Busca proteína, creatina o una marca" value={query} onChange={event => setQuery(event.target.value)} />
          <button type="submit" className="header-search-submit" aria-label="Buscar"><Search size={20} /></button>
        </form>
        <div className="header-actions">
          {user ? (
            <>
              <button type="button" className="header-action" onClick={onOrders} aria-label="Mis pedidos">
                <UserRound size={22} aria-hidden="true" />
                <span className="header-action-text"><small>Hola, {user.name.split(" ")[0]}</small>Mis pedidos</span>
              </button>
              {user.role === "ADMIN" && <a className="header-action header-action-text-only header-desktop-only" href={adminUrl}>Panel</a>}
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
