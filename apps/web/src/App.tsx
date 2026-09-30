import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useApolloClient } from "@apollo/client";
import type { AuthUser } from "@vital-forge/shared-logic";
import { type AuthMode, AuthDialog } from "./components/AuthDialog";
import { CartDrawer } from "./components/CartDrawer";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { MobileMenu } from "./components/MobileMenu";
import { Toaster } from "./components/Toaster";
import { catalogHref } from "./lib/catalogUrl";
import { linkGuestOrders } from "./lib/guestOrders";
import { showToast } from "./lib/toast";
import { useAnyModalLayer } from "./lib/modalLayers";
import { Link, usePageEntry, useRoute } from "./lib/router";
import { HomePage } from "./pages/HomePage";

const loadCatalog = () => import("./pages/CatalogPage");
const loadProduct = () => import("./pages/ProductPage");
const loadCampaign = () => import("./pages/CampaignPage");
const loadTrack = () => import("./pages/TrackOrderPage");
const loadLegal = () => import("./pages/LegalPage");
const CatalogPage = lazy(() => loadCatalog().then(module => ({ default: module.CatalogPage })));
const ProductPage = lazy(() => loadProduct().then(module => ({ default: module.ProductPage })));
const CampaignPage = lazy(() => loadCampaign().then(module => ({ default: module.CampaignPage })));
const TrackOrderPage = lazy(() => loadTrack().then(module => ({ default: module.TrackOrderPage })));
const LegalPage = lazy(() => loadLegal().then(module => ({ default: module.LegalPage })));
const MyOrdersDialog = lazy(() => import("./components/MyOrdersDialog").then(module => ({ default: module.MyOrdersDialog })));

const ADMIN_URL = import.meta.env.VITE_ADMIN_URL ?? "http://localhost:5174";

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("rawenergy-user") || "null") as AuthUser | null;
  } catch {
    return null;
  }
}

function NotFound() {
  const heading = useRef<HTMLHeadingElement>(null);
  usePageEntry("Página no encontrada", heading);
  return (
    <div className="container status-page">
      <h1 ref={heading} tabIndex={-1}>No encontramos esta página</h1>
      <p>El enlace puede estar incompleto o la página ya no existe.</p>
      <div className="empty-actions"><Link to="/" className="btn btn-primary">Ir al inicio</Link><Link to={catalogHref()} className="btn btn-outline">Ver catálogo</Link></div>
    </div>
  );
}

export default function App() {
  const { route } = useRoute();
  const [authOpen, setAuthOpen] = useState<AuthMode | null>(null);
  const [user, setUser] = useState<AuthUser | null>(readStoredUser);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const client = useApolloClient();
  const dialogOpen = useAnyModalLayer();

  // Enlace directo a una sección (/#envios): React pinta después de que el
  // navegador intentó saltar, así que se repite al montar.
  useEffect(() => {
    if (window.location.hash) requestAnimationFrame(() => document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView());
  }, []);

  // Descarga catálogo y ficha en segundo plano para que el primer cambio de vista sea inmediato.
  useEffect(() => {
    const preload = () => { void loadCatalog(); void loadProduct(); void loadCampaign(); };
    if ("requestIdleCallback" in window) { const id = window.requestIdleCallback(preload, { timeout: 3000 }); return () => window.cancelIdleCallback(id); }
    const timer = setTimeout(preload, 1500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [dialogOpen]);

  // Con el fondo inerte el navegador pierde el elemento activo: se recuerda el
  // último control usado y se le devuelve el foco al cerrar el último diálogo.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const hadDialog = useRef(false);
  const openedAt = useRef("");
  useEffect(() => {
    const here = () => window.location.pathname + window.location.search + window.location.hash;
    if (dialogOpen && !hadDialog.current) openedAt.current = here();
    const restore = hadDialog.current && !dialogOpen;
    hadDialog.current = dialogOpen;
    if (!restore) return;
    const frame = requestAnimationFrame(() => {
      // Si se navegó desde el diálogo (p. ej. un enlace del menú), la página nueva ya llevó el foco a su título.
      if (here() !== openedAt.current) return;
      if (returnFocusTo.current?.isConnected) returnFocusTo.current.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [dialogOpen]);

  const logout = () => {
    localStorage.removeItem("rawenergy-token");
    localStorage.removeItem("rawenergy-user");
    setUser(null);
    setOrdersOpen(false);
  };
  const openOrders = () => user ? setOrdersOpen(true) : setAuthOpen("login");

  // Al entrar o crear la cuenta se enlazan los pedidos hechos sin sesión en este navegador (C44).
  const authed = (next: AuthUser) => {
    setUser(next);
    if (next.role !== "CUSTOMER") return;
    linkGuestOrders(client).then(linked => {
      if (!linked.length) return;
      showToast(linked.length === 1 ? `Tu pedido ${linked[0]} ya está en Mis pedidos.` : `Agregamos ${linked.length} pedidos que hiciste sin cuenta a Mis pedidos.`, { label: "Ver", run: () => setOrdersOpen(true) });
    }).catch(() => { /* se reintenta al abrir Mis pedidos */ });
  };

  return (
    <div className="site-shell">
      <div className="store-content" inert={dialogOpen}
        onFocusCapture={event => { if (event.currentTarget.contains(event.target)) returnFocusTo.current = event.target as HTMLElement; }}
        onClickCapture={event => {
          // Los eventos de React cruzan los portales (p. ej. la ampliación de fotos): solo cuenta lo que está en la tienda.
          const trigger = (event.target as Element).closest<HTMLElement>("button, a, input, select");
          if (trigger && event.currentTarget.contains(trigger)) returnFocusTo.current = trigger;
        }}>
        <Header user={user} adminUrl={ADMIN_URL} menuOpen={menuOpen} onMenu={() => setMenuOpen(true)} onLogin={() => setAuthOpen("login")} onOrders={openOrders} onLogout={logout} />
        <main id="contenido" tabIndex={-1} className="page">
          <Suspense fallback={<p className="container loading-line" role="status">Cargando…</p>}>
            {route.name === "home" ? <HomePage />
              : route.name === "catalog" ? <CatalogPage search={route.search} />
              : route.name === "product" ? <ProductPage slug={route.slug} />
              : route.name === "campaign" ? <CampaignPage slug={route.slug} />
              : route.name === "track" ? <TrackOrderPage search={route.search} />
              : route.name === "legal" ? <LegalPage topic={route.topic} />
              : <NotFound />}
          </Suspense>
        </main>
        <Footer onOrders={openOrders} />
      </div>
      <MobileMenu open={menuOpen} user={user} adminUrl={ADMIN_URL} onClose={closeMenu} onLogin={setAuthOpen} onOrders={openOrders} onLogout={logout} />
      <CartDrawer />
      <Toaster />
      {authOpen && <AuthDialog mode={authOpen} adminUrl={ADMIN_URL} onMode={setAuthOpen} onClose={() => setAuthOpen(null)} onAuthed={authed} />}
      {ordersOpen && user && <Suspense fallback={<p className="loading-dialog" role="status">Cargando pedidos…</p>}><MyOrdersDialog email={user.email} onClose={() => setOrdersOpen(false)} /></Suspense>}
    </div>
  );
}
