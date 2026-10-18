import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApolloError, useMutation } from "@apollo/client";
import { Eye, EyeOff, X } from "lucide-react";
import { CONFIRM_EMAIL_CHANGE, RESET_PASSWORD, VERIFY_EMAIL } from "@vital-forge/shared-logic";
import { friendlyError } from "../lib/errors";
import { useModalA11y } from "../lib/useModalA11y";

import type { AccountLink, AccountLinkKind } from "../lib/accountLink";

const titles: Record<AccountLinkKind, string> = { verificar: "Confirmar mi correo", restablecer: "Crear una contraseña nueva", "cambio-correo": "Confirmar mi nuevo correo" };

export function AccountLinkDialog({ link, onClose, onLogin, onSignedOut }: { link: AccountLink; onClose: () => void; onLogin: () => void; onSignedOut: () => void }) {
  const [verifyEmail] = useMutation(VERIFY_EMAIL);
  const [confirmChange] = useMutation(CONFIRM_EMAIL_CHANGE);
  const [resetPassword, resetState] = useMutation(RESET_PASSWORD);
  const [state, setState] = useState<"working" | "form" | "done" | "error">(link.kind === "restablecer" ? "form" : "working");
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { dialogRef, headingRef } = useModalA11y<HTMLFormElement, HTMLHeadingElement>(onClose);
  const statusRef = useRef<HTMLDivElement>(null);
  // El enlace sirve una vez: el doble efecto de desarrollo no debe gastarlo dos veces.
  const started = useRef(false);

  useEffect(() => { headingRef.current?.focus(); }, [headingRef]);
  useEffect(() => { if (state === "done" || state === "error") statusRef.current?.focus(); }, [state]);
  useEffect(() => {
    if (link.kind === "restablecer" || started.current) return;
    started.current = true;
    const run = link.kind === "verificar" ? verifyEmail({ variables: { token: link.token } }) : confirmChange({ variables: { token: link.token } });
    run.then(() => {
      if (link.kind === "cambio-correo") onSignedOut();
      setMessage(link.kind === "verificar"
        ? "Confirmamos tu correo. Ya puedes entrar con tu contraseña."
        : "Tu correo de acceso cambió. Por seguridad cerramos tus sesiones: entra con tu nuevo correo.");
      setState("done");
    }).catch(caught => { setMessage(friendlyError(caught, "No pudimos usar este enlace. Vuelve a intentarlo.")); setState("error"); });
  }, [link, verifyEmail, confirmChange, onSignedOut]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state !== "form" || resetState.loading) return;
    if (password.length < 8) { setPasswordError("La contraseña necesita al menos 8 caracteres."); document.getElementById("link-password")?.focus(); return; }
    try {
      await resetPassword({ variables: { token: link.token, password } });
      onSignedOut();
      setMessage("Listo, tu contraseña cambió y cerramos tus sesiones abiertas. Ya puedes entrar con la nueva.");
      setState("done");
    } catch (caught) {
      const weak = caught instanceof ApolloError ? caught.graphQLErrors.find(issue => issue.extensions?.field === "password") : undefined;
      if (weak) { setPasswordError(weak.message); document.getElementById("link-password")?.focus(); return; }
      setMessage(friendlyError(caught, "No pudimos cambiar la contraseña. Vuelve a intentarlo.")); setState("error");
    }
  };

  return (
    <div className="modal-backdrop auth-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="modal auth-card" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="link-heading" onSubmit={submit} noValidate>
        <button className="icon-btn modal-close" type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        <h2 id="link-heading" ref={headingRef} tabIndex={-1}>{titles[link.kind]}</h2>
        {state === "working" && <p className="loading-line" role="status">Comprobando el enlace…</p>}
        {state === "form" && <>
          <p className="muted auth-intro">Elige una contraseña nueva para tu cuenta. El enlace vence 30 minutos después de pedirlo.</p>
          <div className="field">
            <label htmlFor="link-password">Contraseña nueva</label>
            <div className="password-field">
              <input id="link-password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={200} value={password} aria-invalid={!!passwordError} aria-describedby={passwordError ? "link-password-error link-password-help" : "link-password-help"} onChange={event => { setPassword(event.target.value); setPasswordError(""); }} required />
              <button type="button" className="password-toggle" onClick={() => setShowPassword(value => !value)} aria-pressed={showPassword} aria-controls="link-password" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
                {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
              </button>
            </div>
            {passwordError && <small id="link-password-error" className="field-error">{passwordError}</small>}
            <small id="link-password-help" className="field-help">Mínimo 8 caracteres. Evita contraseñas comunes y tu correo.</small>
          </div>
          <button className="btn btn-primary btn-block btn-lg" disabled={resetState.loading}>{resetState.loading ? "Guardando…" : "Guardar contraseña"}</button>
        </>}
        {(state === "done" || state === "error") && <>
          <div className={state === "done" ? "notice" : "notice notice-error"} role={state === "done" ? "status" : "alert"} tabIndex={-1} ref={statusRef}>{message}</div>
          <div className="auth-foot">
            <button type="button" className="btn btn-primary btn-block" onClick={onLogin}>{state === "done" ? "Entrar" : "Ir a entrar y pedir otro enlace"}</button>
            <button type="button" className="btn-link" onClick={onClose}>Seguir comprando</button>
          </div>
        </>}
      </form>
    </div>
  );
}
