import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApolloError, gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { Eye, EyeOff, X } from "lucide-react";
import { CHECKOUT_INFO, type CheckoutInfo, LOGIN, REGISTER, type AuthPayload, type AuthUser } from "@vital-forge/shared-logic";
import { emailProblem } from "../lib/ecuador";
import { Turnstile } from "./Turnstile";
import { friendlyError } from "../lib/errors";
import { useModalA11y } from "../lib/useModalA11y";
import { whatsappHref } from "../lib/whatsapp";

export type AuthMode = "login" | "register";
type AuthMutationResult = { login?: AuthPayload; register?: AuthPayload };
type Field = "name" | "email" | "password";

/** Mismo patrón que el formulario de entrega (C57): mensaje propio bajo el campo, sin la burbuja del navegador. */
function problems(form: Record<Field, string>, isLogin: boolean) {
  const found: Partial<Record<Field, string>> = {};
  if (!isLogin && form.name.trim().length < 2) found.name = form.name.trim() ? "Escribe al menos 2 caracteres." : "Escribe tu nombre completo.";
  if (!form.email.trim()) found.email = "Escribe tu correo, por ejemplo nombre@gmail.com.";
  else { const issue = emailProblem(form.email); if (issue) found.email = issue; }
  if (!form.password) found.password = "Escribe tu contraseña.";
  else if (!isLogin && form.password.length < 8) found.password = "La contraseña necesita al menos 8 caracteres.";
  return found;
}

/**
 * Acceso de clientes (C43). Centrada en escritorio; en el móvil se ancla arriba
 * para que el teclado no tape los campos. Pestañas Entrar/Crear cuenta, contraseña
 * visible a pedido y salida clara para seguir comprando sin cuenta.
 */
// Cierra en el servidor la sesión recién creada de una cuenta del personal (C62, S10).
const END_SESSION = gql`mutation EndStaffSessionInStore { logout }`;

export function AuthDialog({ mode, adminUrl, onMode, onClose, onAuthed }: { mode: AuthMode; adminUrl: string; onMode: (mode: AuthMode) => void; onClose: () => void; onAuthed: (user: AuthUser) => void }) {
  const client = useApolloClient();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  // El personal entra por el panel: su sesión no se guarda en la tienda (C62, S10).
  const [staffAccount, setStaffAccount] = useState(false);
  // Comprobación de persona al crear la cuenta (C70), solo si la API publica la clave.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [login, loginState] = useMutation<AuthMutationResult>(LOGIN);
  const [register, registerState] = useMutation<AuthMutationResult>(REGISTER);
  const { data: info } = useQuery<{ checkoutInfo: CheckoutInfo }>(CHECKOUT_INFO);
  const whatsapp = info?.checkoutInfo.whatsapp;
  const loading = loginState.loading || registerState.loading;
  const { dialogRef, headingRef } = useModalA11y<HTMLFormElement, HTMLHeadingElement>(onClose);
  const errorRef = useRef<HTMLDivElement>(null);
  const isLogin = mode === "login";

  useEffect(() => { headingRef.current?.focus(); setError(""); setFieldErrors({}); }, [mode, headingRef]);
  useEffect(() => { if (error || staffAccount) errorRef.current?.focus(); }, [error, staffAccount]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setError("");
    const found = problems(form, isLogin);
    setFieldErrors(found);
    const first = (["name", "email", "password"] as const).find(field => found[field]);
    if (first) { document.getElementById(`auth-${first}`)?.focus(); return; }
    if (!isLogin && info?.checkoutInfo.captchaSiteKey && !captchaToken && !captchaUnavailable) { setError("Estamos comprobando la conexión de forma segura. Vuelve a pulsar «Crear cuenta» en unos segundos."); return; }
    try {
      const result = isLogin
        ? await login({ variables: { input: { email: form.email.trim(), password: form.password } } })
        : await register({ variables: { input: { ...form, name: form.name.trim(), email: form.email.trim(), ...(captchaToken ? { captchaToken } : {}) } } }).finally(() => setCaptchaReset(value => value + 1));
      const payload = isLogin ? result.data?.login : result.data?.register;
      if (!payload) return;
      if (payload.user.role !== "CUSTOMER") {
        await client.mutate({ mutation: END_SESSION, context: { headers: { authorization: `Bearer ${payload.token}` } } }).catch(() => undefined);
        setStaffAccount(true);
        return;
      }
      localStorage.setItem("rawenergy-token", payload.token);
      localStorage.setItem("rawenergy-user", JSON.stringify(payload.user));
      await client.resetStore();
      onAuthed(payload.user);
      onClose();
    } catch (caught) {
      // Contraseña rechazada por la política del servidor (C60): el mensaje va junto al campo.
      // Solo las cuentas del personal tienen verificación en dos pasos (C69): entran por el panel.
      if (caught instanceof ApolloError && caught.graphQLErrors.some(issue => issue.extensions?.code === "MFA_REQUIRED")) { setStaffAccount(true); return; }
      const weak = caught instanceof ApolloError ? caught.graphQLErrors.find(issue => issue.extensions?.field === "password") : undefined;
      if (weak) { setFieldErrors({ password: weak.message }); document.getElementById("auth-password")?.focus(); return; }
      setError(friendlyError(caught, isLogin ? "No pudimos iniciar sesión. Vuelve a intentarlo." : "No pudimos crear la cuenta. Vuelve a intentarlo."));
    }
  };

  const describedBy = error || staffAccount ? "auth-error" : undefined;
  const change = (field: Field, value: string) => { setForm(current => ({ ...current, [field]: value })); setFieldErrors(current => ({ ...current, [field]: undefined })); };
  const fieldProps = (field: Field, help?: string) => ({ id: `auth-${field}`, "aria-invalid": !!fieldErrors[field], "aria-describedby": [help ?? "", fieldErrors[field] ? `auth-error-${field}` : "", describedBy ?? ""].filter(Boolean).join(" ") || undefined });
  const fieldError = (field: Field) => fieldErrors[field] ? <small id={`auth-error-${field}`} className="field-error">{fieldErrors[field]}</small> : null;
  return (
    <div className="modal-backdrop auth-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="modal auth-card" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="auth-heading" aria-describedby="auth-intro" onSubmit={submit} noValidate>
        <button className="icon-btn modal-close" type="button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        <h2 id="auth-heading" ref={headingRef} tabIndex={-1}>{isLogin ? "Entrar a mi cuenta" : "Crear cuenta"}</h2>

        <div className="auth-switch" role="group" aria-label="Elige cómo continuar">
          <button type="button" aria-pressed={isLogin} onClick={() => onMode("login")}>Entrar</button>
          <button type="button" aria-pressed={!isLogin} onClick={() => onMode("register")}>Crear cuenta</button>
        </div>

        <p id="auth-intro" className="muted auth-intro">{isLogin
          ? "Consulta tus pedidos y su estado."
          : "Guarda tus pedidos en un solo lugar. Los que hiciste sin cuenta con este correo se agregan a Mis pedidos: los de este dispositivo al instante y los demás con su número."}</p>

        {!isLogin && <label className="field"><span>Nombre completo</span><input {...fieldProps("name")} autoComplete="name" minLength={2} maxLength={100} value={form.name} onChange={event => change("name", event.target.value)} required />{fieldError("name")}</label>}
        <label className="field"><span>Correo</span><input type="email" {...fieldProps("email")} autoComplete="email" inputMode="email" maxLength={120} value={form.email} onChange={event => change("email", event.target.value)} placeholder="tu@correo.com" required />{fieldError("email")}</label>
        <div className="field">
          <label htmlFor="auth-password">Contraseña</label>
          <div className="password-field">
            <input {...fieldProps("password", isLogin ? undefined : "auth-password-help")} type={showPassword ? "text" : "password"} autoComplete={isLogin ? "current-password" : "new-password"} minLength={isLogin ? 1 : 8} maxLength={200} value={form.password} onChange={event => change("password", event.target.value)} required />
            <button type="button" className="password-toggle" onClick={() => setShowPassword(value => !value)} aria-pressed={showPassword} aria-controls="auth-password" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
              {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
            </button>
          </div>
          {fieldError("password")}
          {!isLogin && <small id="auth-password-help" className="field-help">Mínimo 8 caracteres. Evita contraseñas comunes y tu correo.</small>}
        </div>

        {staffAccount
          ? <div id="auth-error" className="notice" role="alert" tabIndex={-1} ref={errorRef}><span>Esta es una cuenta del personal: entra por el panel. En la tienda solo se usan cuentas de cliente.</span> <a className="btn btn-primary btn-sm" href={adminUrl}>Ir al panel</a></div>
          : error && <div id="auth-error" className="notice notice-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
        {!isLogin && info?.checkoutInfo.captchaSiteKey && <Turnstile siteKey={info.checkoutInfo.captchaSiteKey} resetKey={captchaReset} onToken={setCaptchaToken} onUnavailable={() => setCaptchaUnavailable(true)} />}
        {!isLogin && captchaUnavailable && <p className="field-help" role="status">No se pudo cargar la verificación de seguridad. Si tienes un bloqueador, permítelo en esta tienda y recarga la página.</p>}
        <button className="btn btn-primary btn-block btn-lg" disabled={loading}>{loading ? "Validando…" : isLogin ? "Entrar" : "Crear cuenta"}</button>

        <div className="auth-foot">
          {isLogin && whatsapp && <a href={whatsappHref(whatsapp, "Hola RawEnergy, olvidé la contraseña de mi cuenta de la tienda.")} target="_blank" rel="noopener noreferrer">¿Olvidaste tu contraseña? Escríbenos por WhatsApp<span className="sr-only"> (se abre en otra pestaña)</span></a>}
          <button type="button" className="btn-link" onClick={onClose}>Seguir comprando sin cuenta</button>
        </div>
      </form>
    </div>
  );
}
