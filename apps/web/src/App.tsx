import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useApolloClient, useQuery } from "@apollo/client";
import { type AuthUser, CHECKOUT_INFO, type CheckoutInfo, LOGOUT, useCartStore } from "@vital-forge/shared-logic";
import type { AuthMode } from "./components/AuthDialog";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { MobileMenu } from "./components/MobileMenu";
import { Toaster } from "./components/Toaster";
import { catalogHref } from "./lib/catalogUrl";
import { linkGuestOrders } from "./lib/guestOrders";
import { readAccountLink } from "./lib/accountLink";
import { showToast, type Toast } from "./lib/toast";
import { AccessRequired } from "./components/AccessRequired";
import { useAnyModalLayer } from "./lib/modalLayers";
import { Link, navigate, usePageEntry, useRoute } from "./lib/router";
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
// Carrito con la entrega (lista de 223 cantones) y acceso se descargan aparte (C64, V15): no hacen
// falta para ver la portada. Se precargan en reposo y se montan al abrirlos.
const loadCart = () => import("./components/CartDrawer");
const loadAuth = () => import("./components/AuthDialog");
const CartDrawer = lazy(() => loadCart().then(module => ({ default: module.CartDrawer })));
const AuthDialog = lazy(() => loadAuth().then(module => ({ default: module.AuthDialog })));
// CU04: confirmar correo, crear contraseña nueva o confirmar el cambio de correo desde el enlace recibido.
const AccountLinkDialog = lazy(() => import("./components/AccountLinkDialog").then(module => ({ default: module.AccountLinkDialog })));
// CU05: cuenta y pedidos como páginas propias; se descargan solo al visitarlas.
const AccountPage = lazy(() => import("./pages/AccountPage").then(module => ({ default: module.AccountPage })));
const OrdersPage = lazy(() => import("./pages/OrdersPage").then(module => ({ default: module.OrdersPage })));

const ADMIN_URL = import.meta.env.VITE_ADMIN_URL ?? "http://localhost:5174";

function readStoredUser() {
  try {
    const stored = JSON.parse(localStorage.getItem("rawenergy-user") || "null") as AuthUser | null;
    // Sesiones del personal guardadas antes de C62 (S10): la tienda solo conserva cuentas de cliente.
    if (stored && stored.role !== "CUSTOMER") { localStorage.removeItem("rawenergy-token"); localStorage.removeItem("rawenergy-user"); return null; }
    return stored;
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
  const [accountLink, setAccountLink] = useState(() => readAccountLink(window.location.hash));
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const client = useApolloClient();
  const dialogOpen = useAnyModalLayer();
  const cartOpen = useCartStore(state => state.isOpen);
  const toggleCart = useCartStore(state => state.toggleCart);
  // CU08: entrar desde el checkout cierra el carrito (no se superponen diálogos) y lo reabre en el mismo paso.
  const resumeCheckout = useRef(false);
  const loginFromCheckout = useCallback(() => { resumeCheckout.current = true; toggleCart(false); setAuthOpen("login"); }, [toggleCart]);
  const closeAuth = useCallback(() => {
    setAuthOpen(null);
    if (resumeCheckout.current) { resumeCheckout.current = false; toggleCart(true, "checkout"); }
  }, [toggleCart]);
  // El carrito se monta cerrado tras la precarga (así se anima al abrir) o al pedirlo antes.
  const [cartReady, setCartReady] = useState(false);

  // Enlace directo a una sección (/#envios): React pinta después de que el
  // navegador intentó saltar, así que se repite al montar.
  useEffect(() => {
    if (window.location.hash) requestAnimationFrame(() => document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView());
  }, []);

  // Descarga catálogo y ficha en segundo plano para que el primer cambio de vista sea inmediato.
  useEffect(() => {
    const preload = () => { void loadCatalog(); void loadProduct(); void loadCampaign(); void loadAuth(); void loadCart().then(() => setCartReady(true)); };
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

  // El token del enlace sale de la dirección antes de usarlo: no queda en el historial ni se comparte (CU04).
  useEffect(() => {
    if (accountLink) history.replaceState(history.state, "", window.location.pathname + window.location.search);
  }, [accountLink]);
  // El enlace también puede llegar con la tienda ya abierta en la misma pestaña: solo cambia el fragmento (#).
  // Se cierran acceso, carrito y menú para no apilar diálogos (plan §10).
  useEffect(() => {
    const onHash = () => {
      const link = readAccountLink(window.location.hash);
      if (!link) return;
      setAuthOpen(null); setMenuOpen(false); toggleCart(false);
      setAccountLink(link);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [toggleCart]);

  // Cierra la sesión en este dispositivo: sin datos privados en pantalla ni en la caché de Apollo.
  const clearSession = useCallback(() => {
    localStorage.removeItem("rawenergy-token");
    localStorage.removeItem("rawenergy-user");
    setUser(null);
    void client.clearStore();
  }, [client]);
  // CU04: el cierre de sesión también revoca la sesión en el servidor. Sin conexión no se afirma que se cerró allí.
  const logout = () => {
    setUser(null);
    client.mutate({ mutation: LOGOUT })
      .catch(() => showToast("Cerraste sesión en este dispositivo. No pudimos confirmarlo con la tienda: si usaste un equipo compartido, cierra tus sesiones desde tu cuenta cuando tengas conexión."))
      .finally(clearSession);
  };
  // Otra pestaña cerró la sesión o entró con otra cuenta: esta no conserva datos de la anterior.
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== "rawenergy-token" && event.key !== null) return;
      const next = readStoredUser();
      if (!next || next.id !== user?.id) { setUser(next); void client.clearStore(); }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [client, user?.id]);
  // CLI-01: mientras la tienda no ofrece cuentas, «pedidos» lleva a «Consulta tu pedido» y una sesión de
  // cliente guardada antes se cierra sin aviso: se sigue comprando como invitado.
  const { data: storeInfo } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const accounts = storeInfo?.checkoutInfo.customerAccounts === true;
  useEffect(() => { if (storeInfo && !storeInfo.checkoutInfo.customerAccounts && user) clearSession(); }, [storeInfo, user, clearSession]);
  const openOrders = () => navigate(user || accounts ? "/mis-pedidos" : "/pedido");

  // CU05: el Toaster descarta avisos con un diálogo abierto; los avisos del acceso esperan a que se cierre.
  const [pending, setPending] = useState<Array<{ message: string; action?: Toast["action"] }>>([]);
  const dialogOpenRef = useRef(dialogOpen);
  dialogOpenRef.current = dialogOpen;
  const notify = useCallback((message: string, action?: Toast["action"]) => {
    if (dialogOpenRef.current) setPending(current => [...current, { message, action }]);
    else showToast(message, action);
  }, []);
  useEffect(() => {
    if (dialogOpen || !pending.length) return;
    pending.forEach(toast => showToast(toast.message, toast.action));
    setPending([]);
  }, [dialogOpen, pending]);

  // Al entrar se confirma el acceso y se enlazan los pedidos hechos sin sesión en este navegador (C44).
  // Se queda en la página actual: catálogo, carrito o la sección privada que pidió entrar.
  const authed = (next: AuthUser) => {
    setUser(next);
    if (next.role !== "CUSTOMER") return;
    const first = next.name.trim().split(/\s+/)[0] ?? "";
    const privatePage = route.name === "account" || route.name === "orders" || route.name === "orderDetail";
    // Desde el checkout la confirmación se muestra dentro del carrito, que se reabre al momento (CU08).
    if (!resumeCheckout.current) notify(`Sesión iniciada${first ? `, ${first}` : ""}.`, privatePage ? undefined : { label: "Mi cuenta", run: () => navigate("/cuenta") });
    linkGuestOrders(client).then(linked => {
      if (!linked.length) return;
      notify(linked.length === 1 ? `Tu pedido ${linked[0]} ya está en Mis pedidos.` : `Agregamos ${linked.length} pedidos que hiciste sin cuenta a Mis pedidos.`, { label: "Ver", run: () => navigate("/mis-pedidos") });
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
        <Header user={user} menuOpen={menuOpen} onMenu={() => setMenuOpen(true)} onLogin={() => setAuthOpen("login")} onLogout={logout} />
        <main id="contenido" tabIndex={-1} className="page">
          <Suspense fallback={<p className="container loading-line loading-page" role="status">Cargando…</p>}>
            {route.name === "home" ? <HomePage />
              : route.name === "catalog" ? <CatalogPage search={route.search} />
              : route.name === "product" ? <ProductPage slug={route.slug} />
              : route.name === "campaign" ? <CampaignPage slug={route.slug} />
              : route.name === "track" ? <TrackOrderPage search={route.search} />
              : route.name === "legal" ? <LegalPage topic={route.topic} />
              : route.name === "account" ? (user ? <AccountPage user={user} section={route.section} onSignedOut={clearSession} /> : <AccessRequired title="Mi cuenta" accounts={storeInfo ? accounts : undefined} onLogin={setAuthOpen} />)
              : route.name === "orders" || route.name === "orderDetail" ? (user ? <OrdersPage email={user.email} number={route.name === "orderDetail" ? route.number : undefined} onBlocked={() => { clearSession(); showToast("Cancelamos tu pedido. Tu cuenta quedó bloqueada por seguridad: escríbenos por WhatsApp para revisarla."); }} /> : <AccessRequired title="Mis pedidos" accounts={storeInfo ? accounts : undefined} onLogin={setAuthOpen} />)
              : <NotFound />}
          </Suspense>
        </main>
        <Footer onOrders={openOrders} accounts={accounts} />
      </div>
      <MobileMenu open={menuOpen} user={user} onClose={closeMenu} onLogin={setAuthOpen} onLogout={logout} />
      {(cartReady || cartOpen) && <Suspense fallback={null}><CartDrawer user={user} onLogin={loginFromCheckout} /></Suspense>}
      <Toaster />
      {authOpen && <Suspense fallback={<p className="loading-dialog" role="status">Cargando…</p>}><AuthDialog mode={authOpen} adminUrl={ADMIN_URL} onMode={setAuthOpen} onClose={closeAuth} onAuthed={authed} /></Suspense>}
      {accountLink && <Suspense fallback={<p className="loading-dialog" role="status">Cargando…</p>}><AccountLinkDialog link={accountLink} onClose={() => setAccountLink(null)} onLogin={() => { setAccountLink(null); setAuthOpen("login"); }} onSignedOut={clearSession} /></Suspense>}
    </div>
  );
}
