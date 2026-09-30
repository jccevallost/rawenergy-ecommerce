import { type FormEvent, useEffect, useRef, useState } from "react";
import { useApolloClient, useMutation, useQuery } from "@apollo/client";
import { Eye, EyeOff, X } from "lucide-react";
import { CHECKOUT_INFO, type CheckoutInfo, LOGIN, REGISTER, type AuthPayload, type AuthUser } from "@vital-forge/shared-logic";
import { friendlyError } from "../lib/errors";
import { useModalA11y } from "../lib/useModalA11y";
import { whatsappHref } from "../lib/whatsapp";

export type AuthMode = "login" | "register";
type AuthMutationResult = { login?: AuthPayload; register?: AuthPayload };

/**
 * Acceso de clientes (C43). Centrada en escritorio; en el móvil se ancla arriba
 * para que el teclado no tape los campos. Pestañas Entrar/Crear cuenta, contraseña
 * visible a pedido y salida clara para seguir comprando sin cuenta.
 */
export function AuthDialog({ mode, adminUrl, onMode, onClose, onAuthed }: { mode: AuthMode; adminUrl: string; onMode: (mode: AuthMode) => void; onClose: () => void; onAuthed: (user: AuthUser) => void }) {
  const client = useApolloClient();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [login, loginState] = useMutation<AuthMutationResult>(LOGIN);
  const [register, registerState] = useMutation<AuthMutationResult>(REGISTER);
  const { data: info } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const whatsapp = info?.checkoutInfo.whatsapp;
  const loading = loginState.loading || registerState.loading;
  const { dialogRef, headingRef } = useModalA11y<HTMLFormElement, HTMLHeadingElement>(onClose);
  const errorRef = useRef<HTMLDivElement>(null);
  const isLogin = mode === "login";

  useEffect(() => { headingRef.current?.focus(); setError(""); }, [mode, headingRef]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setError("");
    try {
      const result = isLogin
        ? await login({ variables: { input: { email: form.email.trim(), password: form.password } } })
        : await register({ variables: { input: { ...form, name: form.name.trim(), email: form.email.trim() } } });
      const payload = isLogin ? result.data?.login : result.data?.register;
      if (!payload) return;
      localStorage.setItem("rawenergy-token", payload.token);
      localStorage.setItem("rawenergy-user", JSON.stringify(payload.user));
      await client.resetStore();
      onAuthed(payload.user);
      onClose();
      if (payload.user.role === "ADMIN") window.location.href = adminUrl;
    } catch (caught) {
      setError(friendlyError(caught, isLogin ? "No pudimos iniciar sesión. Vuelve a intentarlo." : "No pudimos crear la cuenta. Vuelve a intentarlo."));
    }
  };

  const describedBy = error ? "auth-error" : undefined;
  return (
    <div className="modal-backdrop auth-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="modal auth-card" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="auth-heading" aria-describedby="auth-intro" onSubmit={submit}>
        <button className="icon-btn modal-close" type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        <h2 id="auth-heading" ref={headingRef} tabIndex={-1}>{isLogin ? "Entrar a mi cuenta" : "Crear cuenta"}</h2>

        <div className="auth-switch" role="group" aria-label="Elige cómo continuar">
          <button type="button" aria-pressed={isLogin} onClick={() => onMode("login")}>Entrar</button>
          <button type="button" aria-pressed={!isLogin} onClick={() => onMode("register")}>Crear cuenta</button>
        </div>

        <p id="auth-intro" className="muted auth-intro">{isLogin
          ? "Consulta tus pedidos y su estado."
          : "Guarda tus pedidos en un solo lugar. Los que hiciste sin cuenta con este correo se agregan a Mis pedidos: los de este dispositivo al instante y los demás con su número."}</p>

        {!isLogin && <label className="field"><span>Nombre completo</span><input autoComplete="name" minLength={2} maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required /></label>}
        <label className="field"><span>Correo</span><input type="email" autoComplete="email" inputMode="email" maxLength={120} aria-describedby={describedBy} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} placeholder="tu@correo.com" required /></label>
        <div className="field">
          <label htmlFor="auth-password">Contraseña</label>
          <div className="password-field">
            <input id="auth-password" type={showPassword ? "text" : "password"} autoComplete={isLogin ? "current-password" : "new-password"} aria-describedby={[isLogin ? "" : "auth-password-help", describedBy ?? ""].filter(Boolean).join(" ") || undefined} minLength={isLogin ? 1 : 8} maxLength={200} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} required />
            <button type="button" className="password-toggle" onClick={() => setShowPassword(value => !value)} aria-pressed={showPassword} aria-controls="auth-password" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
              {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
            </button>
          </div>
          {!isLogin && <small id="auth-password-help" className="field-help">Mínimo 8 caracteres.</small>}
        </div>

        {error && <div id="auth-error" className="notice notice-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
        <button className="btn btn-primary btn-block btn-lg" disabled={loading}>{loading ? "Validando…" : isLogin ? "Entrar" : "Crear cuenta"}</button>

        <div className="auth-foot">
          {isLogin && whatsapp && <a href={whatsappHref(whatsapp, "Hola RawEnergy, olvidé la contraseña de mi cuenta de la tienda.")} target="_blank" rel="noopener noreferrer">¿Olvidaste tu contraseña? Escríbenos por WhatsApp<span className="sr-only"> (se abre en otra pestaña)</span></a>}
          <button type="button" className="btn-link" onClick={onClose}>Seguir comprando sin cuenta</button>
        </div>
      </form>
    </div>
  );
}
