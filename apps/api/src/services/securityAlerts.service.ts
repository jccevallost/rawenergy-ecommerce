import { limitHooks } from "../lib/operationLimiter.js";
import { authService, type AuthRole } from "./auth.service.js";
import { notificationOutbox } from "./outbox.service.js";

// Alertas de seguridad al operador por la cola de avisos (Telegram), C60 (S15). Se
// avisa de lo que pide acción humana: intentos repetidos contra cuentas del personal,
// cuentas o roles de personal nuevos y picos de solicitudes rechazadas por los límites.
// Los contadores viven en la memoria de la instancia.
const FAILURE_WINDOW_MS = 15 * 60_000;
const FAILURES_TO_ALERT = 5;
const LIMITED_WINDOW_MS = 5 * 60_000;
const LIMITED_TO_ALERT = 30;
const MAX_TRACKED = 5000;
const roleNames: Record<AuthRole, string> = { CUSTOMER: "Cliente", CATALOG: "Catálogo", WAREHOUSE: "Bodega", MANAGER: "Gerencia", ADMIN: "Administración" };

export function createSecurityAlerts(deps: {
  now?: () => number;
  roleOf?: (email: string) => Promise<AuthRole | null>;
  send?: (label: string, text: string) => Promise<void>;
} = {}) {
  const now = deps.now ?? Date.now;
  const roleOf = deps.roleOf ?? ((email: string) => authService.roleOf(email));
  const send = deps.send ?? ((label: string, text: string) => notificationOutbox.enqueue([{ kind: "OPERATOR_NOTICE", label, text }]));
  const failures = new Map<string, number[]>();
  const lastAlert = new Map<string, number>();
  let limited: number[] = [];
  const pending = new Set<Promise<unknown>>();

  const track = (task: Promise<unknown>) => {
    const settled = task.catch((error) => console.error("[seguridad] no se pudo encolar la alerta", error)).finally(() => pending.delete(settled));
    pending.add(settled);
  };
  const notify = (key: string, cooldownMs: number, label: string, text: string) => {
    if (now() - (lastAlert.get(key) ?? -Infinity) < cooldownMs) return;
    lastAlert.set(key, now());
    if (lastAlert.size > MAX_TRACKED) lastAlert.delete(lastAlert.keys().next().value!);
    track(send(label, text));
  };

  return {
    /** Un acceso fallido. Desde el 5.º en 15 min contra una cuenta del personal, un aviso cada 15 min. */
    loginFailed(account: string, ip: string) {
      const times = [...(failures.get(account) ?? []).filter((time) => time > now() - FAILURE_WINDOW_MS), now()];
      failures.delete(account);
      failures.set(account, times);
      if (failures.size > MAX_TRACKED) failures.delete(failures.keys().next().value!);
      if (times.length < FAILURES_TO_ALERT || now() - (lastAlert.get(`login:${account}`) ?? -Infinity) < FAILURE_WINDOW_MS) return;
      track(roleOf(account).then((role) => {
        if (!role || role === "CUSTOMER") return;
        notify(`login:${account}`, FAILURE_WINDOW_MS, "alerta de accesos fallidos", `Seguridad: ${times.length} intentos fallidos de acceso a la cuenta del personal ${account} (${roleNames[role]}) en 15 minutos. Última conexión: ${ip || "desconocida"}. Si no fuiste tú, cambia la contraseña y cierra las sesiones en Seguridad.`);
      }));
    },
    /** Una solicitud rechazada por un límite. Con 30 en 5 min, un aviso por hora. */
    rateLimited(source: string) {
      limited = [...limited.filter((time) => time > now() - LIMITED_WINDOW_MS), now()];
      if (limited.length >= LIMITED_TO_ALERT) notify("rate-limit", 60 * 60_000, "alerta de solicitudes rechazadas", `Seguridad: la API rechazó ${limited.length} solicitudes por exceso en 5 minutos (última: ${source}). Puede ser un ataque automatizado o un error de la tienda; revisa la Auditoría.`);
    },
    /** Alta de una cuenta del personal o cambio de rol hacia o dentro del personal. */
    staffAccess(actor: { name: string; email: string }, before: { role: AuthRole } | null, after: { name: string; email: string; role: AuthRole }) {
      if (after.role === "CUSTOMER" || before?.role === after.role) return;
      const change = before ? `pasó de ${roleNames[before.role]} a ${roleNames[after.role]}` : `se creó con el rol ${roleNames[after.role]}`;
      track(send("alerta de acceso del personal", `Seguridad: la cuenta ${after.name} (${after.email}) ${change}; lo hizo ${actor.name} (${actor.email}). Si no lo esperabas, revisa Cuentas en el panel.`));
    },
    /** Administración quitó el segundo factor de otra cuenta (C69). */
    twoFactorReset(actor: { name: string; email: string }, target: { name: string; email: string }) {
      track(send("alerta de segundo factor", `Seguridad: ${actor.name} (${actor.email}) quitó la verificación en dos pasos de la cuenta ${target.name} (${target.email}) y cerró sus sesiones. Si no lo esperabas, revisa Cuentas en el panel.`));
    },
    async flush() { while (pending.size) await Promise.all([...pending]); }
  };
}

export const securityAlerts = createSecurityAlerts();
limitHooks.onLimited = (name) => securityAlerts.rateLimited(`límite de la operación ${name}`);
