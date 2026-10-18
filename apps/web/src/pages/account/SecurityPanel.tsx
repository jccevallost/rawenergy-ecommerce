import { type FormEvent, useState } from "react";
import { useMutation, useQuery } from "@apollo/client";
import { type AccountRequestResult, type AuthUser, MY_SESSIONS, REQUEST_EMAIL_CHANGE, REQUEST_PASSWORD_RESET, REVOKE_SESSIONS } from "@vital-forge/shared-logic";
import { emailProblem } from "../../lib/ecuador";
import { fieldErrorsOf, friendlyError } from "../../lib/errors";
import { TextField } from "./fields";

type Sessions = { sessions: Array<{ id: string; createdAt: string; expiresAt: string; current: boolean }>; legacySession: boolean };
const when = (value: string) => new Date(value).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" });

/**
 * CU06: seguridad de la cuenta. El correo cambia solo al confirmarlo desde el nuevo (CU04); la contraseña se
 * cambia con el mismo enlace de recuperación, que prueba el acceso al correo; las sesiones se cierran en el servidor.
 */
export function SecurityPanel({ user, onSignedOut }: { user: AuthUser; onSignedOut: () => void }) {
  const [changeEmail, emailState] = useMutation<{ requestEmailChange: AccountRequestResult }>(REQUEST_EMAIL_CHANGE);
  const [requestReset, resetState] = useMutation(REQUEST_PASSWORD_RESET);
  const [revoke, revokeState] = useMutation(REVOKE_SESSIONS);
  const sessions = useQuery<{ mySessions: Sessions }>(MY_SESSIONS, { fetchPolicy: "network-only" });
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [emailResult, setEmailResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [resetResult, setResetResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [revokeError, setRevokeError] = useState("");

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (emailState.loading) return;
    const found: Record<string, string> = {};
    const issue = form.email.trim() ? emailProblem(form.email) : "Escribe el nuevo correo.";
    if (issue) found.email = issue;
    else if (form.email.trim().toLowerCase() === user.email) found.email = "Ese ya es tu correo de acceso.";
    if (!form.password) found.password = "Escribe tu contraseña actual para confirmar que eres tú.";
    setErrors(found); setEmailResult(null);
    if (Object.keys(found).length) { document.getElementById(found.email ? "security-email" : "security-password")?.focus(); return; }
    try {
      await changeEmail({ variables: { email: form.email.trim(), password: form.password } });
      setEmailResult({ ok: true, text: `Te enviamos un enlace a ${form.email.trim()}. Tu correo de acceso sigue siendo ${user.email} hasta que lo confirmes desde el nuevo.` });
      setForm({ email: "", password: "" });
    } catch (caught) {
      const fields = fieldErrorsOf(caught);
      if (Object.keys(fields).length) { setErrors(fields); document.getElementById(fields.email ? "security-email" : "security-password")?.focus(); return; }
      setEmailResult({ ok: false, text: friendlyError(caught, "No pudimos pedir el cambio. Vuelve a intentarlo.") });
    }
  };

  const sendReset = async () => {
    try {
      await requestReset({ variables: { email: user.email } });
      setResetResult({ ok: true, text: `Te enviamos a ${user.email} un enlace para crear una contraseña nueva. Vence en 30 minutos.` });
    } catch (caught) { setResetResult({ ok: false, text: friendlyError(caught, "No pudimos enviar el enlace. Vuelve a intentarlo.") }); }
  };

  const closeAll = async () => {
    setRevokeError("");
    try { await revoke(); onSignedOut(); }
    catch (caught) { setRevokeError(friendlyError(caught, "No pudimos cerrar las sesiones. Vuelve a intentarlo.")); }
  };

  const list = sessions.data?.mySessions.sessions ?? [];
  return (
    <>
      <section className="account-card" aria-labelledby="security-email-title">
        <h2 id="security-email-title">Correo de acceso</h2>
        <p>{user.email} · <b>{user.emailVerified ? "confirmado" : "sin confirmar"}</b></p>
        <form className="form-grid account-form" onSubmit={submitEmail} noValidate aria-labelledby="security-email-form">
          <h3 id="security-email-form">Cambiar mi correo</h3>
          <TextField id="security-email" label="Nuevo correo" type="email" inputMode="email" autoComplete="email" maxLength={120} value={form.email} error={errors.email} onChange={event => setForm({ ...form, email: event.target.value })} />
          <TextField id="security-password" label="Contraseña actual" type="password" autoComplete="current-password" maxLength={200} value={form.password} error={errors.password} onChange={event => setForm({ ...form, password: event.target.value })} />
          {emailResult && <p className={`notice ${emailResult.ok ? "notice-success" : "notice-error"}`} role={emailResult.ok ? "status" : "alert"}>{emailResult.text}</p>}
          <div className="account-form-actions"><button className="btn btn-primary" disabled={emailState.loading}>{emailState.loading ? "Enviando…" : "Enviar enlace de confirmación"}</button></div>
        </form>
      </section>

      <section className="account-card" aria-labelledby="security-password-title">
        <h2 id="security-password-title">Contraseña</h2>
        <p className="muted">Para cambiarla te enviamos un enlace a tu correo; así confirmamos que eres tú.</p>
        {resetResult && <p className={`notice ${resetResult.ok ? "notice-success" : "notice-error"}`} role={resetResult.ok ? "status" : "alert"}>{resetResult.text}</p>}
        <div className="account-form-actions"><button type="button" className="btn btn-outline" onClick={() => void sendReset()} disabled={resetState.loading}>{resetState.loading ? "Enviando…" : "Enviarme el enlace"}</button></div>
      </section>

      <section className="account-card" aria-labelledby="security-sessions-title">
        <h2 id="security-sessions-title">Sesiones abiertas</h2>
        {sessions.loading && <p className="muted loading-line" role="status">Cargando sesiones…</p>}
        {sessions.error && <div className="notice notice-error" role="alert"><span>{friendlyError(sessions.error, "No pudimos traer tus sesiones.")}</span><button type="button" className="btn btn-outline btn-sm" onClick={() => void sessions.refetch()}>Reintentar</button></div>}
        {!!list.length && <ul className="session-list">
          {list.map(session => <li key={session.id}><b>{session.current ? "Este dispositivo" : "Otro dispositivo"}</b><small className="muted">Desde {when(session.createdAt)} · vence {when(session.expiresAt)}</small></li>)}
        </ul>}
        <p className="muted">Si usaste un equipo compartido o perdiste el teléfono, cierra todas las sesiones. Tendrás que volver a entrar aquí también.</p>
        {revokeError && <p className="notice notice-error" role="alert">{revokeError}</p>}
        <div className="account-form-actions"><button type="button" className="btn btn-outline" onClick={() => void closeAll()} disabled={revokeState.loading}>{revokeState.loading ? "Cerrando…" : "Cerrar todas las sesiones"}</button></div>
      </section>
    </>
  );
}
