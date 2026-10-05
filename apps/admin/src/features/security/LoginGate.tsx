import { type FormEvent, useState } from "react";
import { ApolloError, useApolloClient, useMutation } from "@apollo/client";
import { Eye, EyeOff } from "lucide-react";
import { LOGIN, type AuthPayload, type AuthUser } from "@vital-forge/shared-logic";
import { RecoveryForm } from "./RecoveryForm";

type Field = "email" | "password";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Mismo patrón que los formularios de la tienda (C57): mensaje bajo el campo y foco en el primero con error. */
function problems(form: Record<Field, string>) {
  const found: Partial<Record<Field, string>> = {};
  if (!form.email.trim()) found.email = "Escribe tu correo de trabajo.";
  else if (!EMAIL.test(form.email.trim())) found.email = "Escribe un correo válido, por ejemplo nombre@rawenergy.ec.";
  if (!form.password) found.password = "Escribe tu contraseña.";
  return found;
}

export function LoginGate({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const client = useApolloClient();
  const [form, setForm] = useState<Record<Field, string>>({ email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [recovery, setRecovery] = useState(location.hash.startsWith("#reset="));
  const [token, setToken] = useState(location.hash.startsWith("#reset=") ? decodeURIComponent(location.hash.slice(7)) : undefined);
  const [error, setError] = useState("");
  const [login, state] = useMutation<{ login: AuthPayload }>(LOGIN);
  // Verificación en dos pasos (C69): la API pide el código después de una contraseña correcta.
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");

  const change = (field: Field, value: string) => {
    setForm(current => ({ ...current, [field]: value }));
    setFieldErrors(current => ({ ...current, [field]: undefined }));
  };
  const describedBy = (field: Field) => [fieldErrors[field] ? `login-error-${field}` : "", error ? "login-error" : ""].filter(Boolean).join(" ") || undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const found = problems(form);
    setFieldErrors(found);
    const first = (["email", "password"] as const).find(field => found[field]);
    if (first) { document.getElementById(`login-${first}`)?.focus(); return; }
    try {
      if (needsCode && !code.trim()) { setError("Escribe el código de tu aplicación o un código de recuperación."); document.getElementById("login-code")?.focus(); return; }
      const result = await login({ variables: { input: { email: form.email.trim(), password: form.password, ...(needsCode ? { code: code.trim() } : {}) } } });
      const payload = result.data?.login;
      if (!payload) return;
      if (payload.user.role === "CUSTOMER") throw new Error("Esta cuenta no tiene acceso al panel de gestión.");
      localStorage.setItem("rawenergy-token", payload.token);
      localStorage.setItem("rawenergy-user", JSON.stringify(payload.user));
      await client.clearStore();
      onLogin(payload.user);
    } catch (caught) {
      if (caught instanceof ApolloError && caught.graphQLErrors.some(issue => issue.extensions?.code === "MFA_REQUIRED")) {
        setNeedsCode(true);
        requestAnimationFrame(() => document.getElementById("login-code")?.focus());
        return;
      }
      setError(caught instanceof Error ? caught.message : "No se pudo iniciar sesión");
      if (needsCode) document.getElementById("login-code")?.focus();
    }
  };

  return (
    <div className="login-shell">
      <div className="login-intro">
        <span className="kicker">RAWENERGY · GESTIÓN</span>
        <h1>Tu tienda,<br />bajo control.</h1>
        <p>Productos, pedidos e inventario en un solo lugar. Información clara para decidir y herramientas simples para trabajar.</p>
      </div>
      <div className="login-card">
        {recovery ? (
          <RecoveryForm token={token} onBack={() => { setRecovery(false); setToken(undefined); history.replaceState(null, "", "#home"); }} />
        ) : (
          <form onSubmit={submit} noValidate>
            <h2>Iniciar sesión</h2>
            <p>Usa el correo y la contraseña de tu equipo.</p>
            <label>Correo
              <input id="login-email" required type="email" inputMode="email" autoComplete="username" value={form.email} aria-invalid={!!fieldErrors.email} aria-describedby={describedBy("email")} onChange={event => change("email", event.target.value)} />
              {fieldErrors.email && <small id="login-error-email" className="field-error">{fieldErrors.email}</small>}
            </label>
            <label>Contraseña
              <span className="password-field">
                <input id="login-password" required type={showPassword ? "text" : "password"} autoComplete="current-password" value={form.password} aria-invalid={!!fieldErrors.password} aria-describedby={describedBy("password")} onChange={event => change("password", event.target.value)} />
                <button type="button" className="password-toggle" onClick={() => setShowPassword(value => !value)} aria-pressed={showPassword} aria-controls="login-password" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
                  {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
                </button>
              </span>
              {fieldErrors.password && <small id="login-error-password" className="field-error">{fieldErrors.password}</small>}
            </label>
            {needsCode && (
              <label>Código de verificación
                <input id="login-code" inputMode="numeric" autoComplete="one-time-code" maxLength={9} value={code} aria-describedby="login-code-help" onChange={event => { setCode(event.target.value); setError(""); }} />
                <small id="login-code-help">Los 6 dígitos de tu aplicación o un código de recuperación (XXXX-XXXX).</small>
              </label>
            )}
            {error && <p id="login-error" role="alert">{error}</p>}
            <button className="primary-button" disabled={state.loading}>{state.loading ? "Entrando…" : "Entrar al panel"}</button>
            <button type="button" onClick={() => setRecovery(true)}>Olvidé mi contraseña</button>
          </form>
        )}
      </div>
    </div>
  );
}
