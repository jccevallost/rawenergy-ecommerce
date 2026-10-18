import { useRef } from "react";
import { UserRound } from "lucide-react";
import { Link, usePageEntry } from "../lib/router";
import type { AuthMode } from "./AuthDialog";

/**
 * CU05: sección privada sin sesión. La ruta se conserva: al entrar, la misma página muestra su contenido,
 * así que no hace falta un parámetro de redirección que alguien pudiera manipular. `accounts` sin definir:
 * aún no se sabe si la tienda ofrece cuentas, y no se muestra una respuesta equivocada.
 */
export function AccessRequired({ title, accounts, onLogin }: { title: string; accounts: boolean | undefined; onLogin: (mode: AuthMode) => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  usePageEntry(title, heading);
  return (
    <div className="container status-page">
      <UserRound size={36} aria-hidden="true" />
      <h1 ref={heading} tabIndex={-1}>{title}</h1>
      {accounts === undefined ? <p className="muted loading-line" role="status">Cargando…</p> : accounts ? <>
        <p>Entra a tu cuenta para ver esta sección. Tu carrito se conserva.</p>
        <div className="empty-actions">
          <button type="button" className="btn btn-primary" onClick={() => onLogin("login")}>Entrar</button>
          <button type="button" className="btn btn-outline" onClick={() => onLogin("register")}>Crear cuenta</button>
        </div>
      </> : <>
        <p>La tienda funciona sin cuentas: compra sin registrarte y consulta tu pedido con su número.</p>
        <div className="empty-actions"><Link to="/pedido" className="btn btn-primary">Consulta tu pedido</Link></div>
      </>}
    </div>
  );
}
