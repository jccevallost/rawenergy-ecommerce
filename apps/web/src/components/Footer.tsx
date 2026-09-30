import { useQuery } from "@apollo/client";
import { CHECKOUT_INFO, type CheckoutInfo, useCartOrchestrator } from "@vital-forge/shared-logic";
import { SiteLogo } from "./Header";
import { catalogHref } from "../lib/catalogUrl";
import { goals } from "../lib/goals";
import { Link } from "../lib/router";
import { formatWhatsapp, whatsappHref } from "../lib/whatsapp";

export function Footer({ onOrders }: { onOrders: () => void }) {
  const { toggleCart } = useCartOrchestrator();
  const { data } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const whatsapp = data?.checkoutInfo.whatsapp;
  return (
    <footer className="site-footer">
      <div className="container footer-grid footer-grid-4">
        <div className="footer-brand">
          <SiteLogo />
          <p>Suplementos deportivos con compra sin cuenta y envío a todo Ecuador mediante Servientrega.</p>
        </div>
        <nav aria-label="Tienda">
          <h2>Tienda</h2>
          <ul>
            <li><Link to={catalogHref()}>Todo el catálogo</Link></li>
            {goals.map(goal => <li key={goal.slug}><Link to={catalogHref({ goals: [goal.slug] })}>{goal.label}</Link></li>)}
          </ul>
        </nav>
        <nav aria-label="Ayuda">
          <h2>Ayuda</h2>
          <ul>
            <li><Link to="/pedido">Consultar mi pedido</Link></li>
            <li><button type="button" className="footer-link" onClick={onOrders}>Mis pedidos con cuenta</button></li>
            <li><button type="button" className="footer-link" onClick={() => toggleCart(true)}>Ver mi carrito</button></li>
            {whatsapp && <li><a href={whatsappHref(whatsapp, "Hola RawEnergy, tengo una consulta.")} rel="noopener noreferrer" target="_blank">WhatsApp {formatWhatsapp(whatsapp)}</a></li>}
          </ul>
        </nav>
        <nav aria-label="Información legal">
          <h2>Legal</h2>
          <ul>
            <li><Link to="/legal/envios">Envíos y pagos</Link></li>
            <li><Link to="/legal/devoluciones">Cambios y devoluciones</Link></li>
            <li><Link to="/legal/terminos">Términos y condiciones</Link></li>
            <li><Link to="/legal/privacidad">Política de privacidad</Link></li>
          </ul>
        </nav>
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} RawEnergy EC · Quito, Ecuador</span>
      </div>
    </footer>
  );
}
