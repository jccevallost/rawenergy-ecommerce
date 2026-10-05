import { gql, useMutation, useQuery } from "@apollo/client";
import { type FormEvent, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useConfirm } from "../../components/common/ConfirmDialog";

const SESSIONS = gql`query MySessions { mySessions }`;
const REVOKE = gql`mutation RevokeSessions { revokeSessions }`;
// Verificación en dos pasos del personal (C69, S10).
const TWO_FACTOR = gql`query MyTwoFactor { me { id twoFactorEnabled } }`;
const START = gql`mutation StartTwoFactor { startTwoFactorSetup { secret otpauthUrl } }`;
const CONFIRM = gql`mutation ConfirmTwoFactor($code: String!) { confirmTwoFactorSetup(code: $code) { recoveryCodes } }`;
const DISABLE = gql`mutation DisableTwoFactor($code: String!) { disableTwoFactor(code: $code) }`;

type Sessions = { sessions: Array<{ id: string; createdAt: string; expiresAt: string; current: boolean }>; legacySession: boolean };
const message = (error: unknown) => error instanceof Error ? error.message : "No se pudo completar la acción.";
// Clave en grupos de 4 para copiarla a mano en la aplicación.
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

function TwoFactor() {
  const status = useQuery<{ me: { id: string; twoFactorEnabled: boolean } | null }>(TWO_FACTOR, { fetchPolicy: "network-only" });
  const [start, starting] = useMutation<{ startTwoFactorSetup: { secret: string; otpauthUrl: string } }>(START);
  const [confirm, confirming] = useMutation<{ confirmTwoFactorSetup: { recoveryCodes: string[] } }>(CONFIRM);
  const [disable, disabling] = useMutation(DISABLE);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const enabled = status.data?.me?.twoFactorEnabled ?? false;

  const begin = async () => {
    setError(""); setNotice(""); setCodes(null);
    try { setSetup((await start()).data?.startTwoFactorSetup ?? null); } catch (caught) { setError(message(caught)); }
  };
  const finish = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    try {
      const result = await confirm({ variables: { code: code.trim() } });
      setCodes(result.data?.confirmTwoFactorSetup.recoveryCodes ?? []);
      setSetup(null); setCode("");
      await status.refetch();
    } catch (caught) { setError(message(caught)); document.getElementById("two-factor-code")?.focus(); }
  };
  const turnOff = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    try {
      await disable({ variables: { code: code.trim() } });
      setCode(""); setNotice("Verificación en dos pasos desactivada."); setCodes(null);
      await status.refetch();
    } catch (caught) { setError(message(caught)); document.getElementById("two-factor-code")?.focus(); }
  };

  return (
    <div className="report-card two-factor">
      <h2><KeyRound aria-hidden="true" /> Verificación en dos pasos</h2>
      <p>{enabled ? "Activa: al entrar se pide también el código de 6 dígitos de tu aplicación." : "Además de la contraseña, pide un código de 6 dígitos que cambia cada 30 segundos en una aplicación del teléfono (Google Authenticator, Microsoft Authenticator, 1Password o Authy)."}</p>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="field-error">{error}</p>}
      {codes && (
        <div className="recovery-codes" role="region" aria-label="Códigos de recuperación">
          <p><b>Guarda estos códigos en un lugar seguro.</b> Cada uno sirve una sola vez si pierdes el teléfono. No se volverán a mostrar.</p>
          <ul>{codes.map((item) => <li key={item}><code>{item}</code></li>)}</ul>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(codes.join("\n")).then(() => setNotice("Códigos copiados."), () => setNotice("Selecciónalos y cópialos a mano."))}>Copiar códigos</button>
        </div>
      )}
      {!enabled && !setup && <button type="button" className="primary-button" disabled={starting.loading || status.loading} onClick={() => void begin()}>Activar verificación en dos pasos</button>}
      {!enabled && setup && (
        <form onSubmit={finish} noValidate>
          <ol className="two-factor-steps">
            <li>En tu aplicación elige «Agregar cuenta» y luego «Ingresar una clave».</li>
            <li>Escribe esta clave: <code className="two-factor-secret">{grouped(setup.secret)}</code> (en el teléfono también puedes <a href={setup.otpauthUrl}>abrirla en la aplicación</a>).</li>
            <li>Escribe el código de 6 dígitos que muestra la aplicación.</li>
          </ol>
          <label>Código de la aplicación
            <input id="two-factor-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} aria-invalid={!!error} />
          </label>
          <button className="primary-button" disabled={confirming.loading || code.length !== 6}>Confirmar y activar</button>
          <button type="button" onClick={() => { setSetup(null); setCode(""); }}>Cancelar</button>
        </form>
      )}
      {enabled && (
        <form onSubmit={turnOff} noValidate>
          <label>Para desactivarla, escribe un código de la aplicación o uno de recuperación
            <input id="two-factor-code" autoComplete="one-time-code" maxLength={9} value={code} onChange={(event) => setCode(event.target.value)} aria-invalid={!!error} />
          </label>
          <button className="danger-button" disabled={disabling.loading || !code.trim()}>Desactivar</button>
        </form>
      )}
    </div>
  );
}

export function SecurityPanel({ onLogout }: { onLogout: () => void }) {
  const query = useQuery<{ mySessions: Sessions }>(SESSIONS, { fetchPolicy: "network-only" });
  const [revoke, state] = useMutation(REVOKE);
  const confirm = useConfirm();
  return (
    <section className="admin-section">
      <div className="section-heading"><div><span className="kicker">MI CUENTA</span><h1>Acceso y sesiones</h1><p>Revisa tus accesos, activa la verificación en dos pasos y cierra las sesiones de todos los dispositivos.</p></div><ShieldCheck /></div>
      {query.error && <p role="alert">{query.error.message}</p>}
      <TwoFactor />
      <div className="report-card">
        <h2>Sesiones vigentes</h2>
        {query.data?.mySessions.sessions.map((s) => <div className="rank-line" key={s.id}><div><b>{s.current ? "Esta sesión" : "Otro acceso"}</b><small>Inicio: {new Date(s.createdAt).toLocaleString("es-EC")}</small></div><span>Vence: {new Date(s.expiresAt).toLocaleString("es-EC")}</span></div>)}
        {query.data?.mySessions.legacySession && <p>Esta sesión se inició con la versión anterior. Puedes cerrarlas todas para renovar el acceso.</p>}
        {state.error && <p role="alert">{state.error.message}</p>}
        <button className="danger-button" disabled={state.loading} onClick={async () => { if (await confirm({ title: "Cerrar todas las sesiones", message: "Se cerrará también tu acceso actual. Deberás iniciar sesión nuevamente.", confirmLabel: "Cerrar sesiones", danger: true })) { try { await revoke(); onLogout(); } catch { /* se muestra arriba */ } } }}>Cerrar todas las sesiones</button>
      </div>
    </section>
  );
}
