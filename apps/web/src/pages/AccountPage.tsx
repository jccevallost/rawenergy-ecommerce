import { useRef } from "react";
import { useQuery } from "@apollo/client";
import { MapPin, ShieldCheck, UserRound } from "lucide-react";
import { type AuthUser, type CustomerProfile, MY_PROFILE } from "@vital-forge/shared-logic";
import { friendlyError } from "../lib/errors";
import { type AccountSection, Link, usePageEntry } from "../lib/router";
import { AddressBook } from "./account/AddressBook";
import { BillingBlock, ContactBlock } from "./account/ProfileBlocks";
import { SecurityPanel } from "./account/SecurityPanel";

const sections: Array<{ id: AccountSection; to: string; label: string; icon: typeof UserRound }> = [
  { id: "perfil", to: "/cuenta", label: "Mi cuenta", icon: UserRound },
  { id: "direcciones", to: "/cuenta/direcciones", label: "Direcciones", icon: MapPin },
  { id: "seguridad", to: "/cuenta/seguridad", label: "Seguridad", icon: ShieldCheck }
];
const titles: Record<AccountSection, string> = { perfil: "Mi cuenta", direcciones: "Mis direcciones", seguridad: "Seguridad de mi cuenta" };
const missingLabels = { phone: "tu celular", billing: "tus datos de factura", address: "una dirección de entrega" } as const;

/** CU05: cuenta del cliente en secciones con su propia dirección. Sin pedidos mezclados con los datos. */
export function AccountPage({ user, section, onSignedOut }: { user: AuthUser; section: AccountSection; onSignedOut: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  usePageEntry(titles[section], heading);
  const { data, loading, error, refetch } = useQuery<{ myProfile: CustomerProfile }>(MY_PROFILE, { fetchPolicy: "cache-and-network" });
  const profile = data?.myProfile;

  return (
    <div className="container account-page">
      <nav className="account-nav" aria-label="Secciones de mi cuenta">
        <ul>
          {sections.map(({ id, to, label, icon: Icon }) => (
            <li key={id}><Link to={to} aria-current={id === section ? "page" : undefined}><Icon size={18} aria-hidden="true" />{label}</Link></li>
          ))}
          <li><Link to="/mis-pedidos">Mis pedidos</Link></li>
        </ul>
      </nav>
      <h1 ref={heading} tabIndex={-1}>{titles[section]}</h1>

      {loading && !profile && <p className="muted loading-line" role="status">Cargando tus datos…</p>}
      {error && !profile && (
        <div className="notice notice-error" role="alert">
          <span>{friendlyError(error, "No pudimos traer tus datos. Tu sesión sigue abierta.")}</span>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void refetch()}>Reintentar</button>
        </div>
      )}

      {profile && section === "perfil" && <>
        {!profile.complete && <p className="notice" role="note">Para comprar sin volver a escribir tus datos, completa {profile.missing.map(key => missingLabels[key]).join(", ")}.{profile.missing.includes("address") && <> <Link to="/cuenta/direcciones">Agregar una dirección</Link></>}</p>}
        <ContactBlock profile={profile} />
        <BillingBlock profile={profile} />
      </>}
      {profile && section === "direcciones" && <AddressBook profile={profile} />}
      {section === "seguridad" && <SecurityPanel user={user} onSignedOut={onSignedOut} />}
    </div>
  );
}
