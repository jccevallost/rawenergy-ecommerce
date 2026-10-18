// Guardas de arranque de la API en Azure (staging y, desde AZURE-PROD-01, producción). Se copian al artefacto y se ejecutan antes de server.js;
// no tocan la API de Render ni server.ts. Funciones puras para poder probarlas (staging-guards.test.mjs).
//
// Perfiles:
// - azure-staging: copia de prueba general. Cuentas de cliente apagadas (CLI-01).
// - azure-staging-cuentas: piloto de la fase de cuentas (CU02). Admite CUSTOMER_ACCOUNTS=on solo con
//   correo simulado y una base sintética rawenergy_stage_cuentas_*; nunca la copia de Atlas con datos reales.
// - azure-produccion: API de producción (AZURE-PROD-01, 17/10/2026). Solo la base `rawenergy_ec`, sin correo
//   simulado y sin CLIENT_IP_HEADER: Azure no está detrás de Cloudflare y esa cabecera la podría falsificar
//   cualquiera para saltarse los límites por IP.

export const STAGING_PROFILES = ["azure-staging", "azure-staging-cuentas", "azure-produccion"];
export const PRODUCTION_DATABASE = "rawenergy_ec";

// Canales y datos que no deben llegar a staging desde producción.
const DISALLOWED = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM", "MAIL_OPERATOR", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_API_URL", "TURNSTILE_SECRET_KEY", "CLIENT_IP_HEADER", "BANK_NAME", "BANK_ACCOUNT_NUMBER", "BANK_HOLDER", "BANK_DOCUMENT"];

/**
 * Problemas que impiden arrancar. `profile` es el perfil con el que se construyó el artefacto;
 * `databaseName` es la base que interpreta el controlador de MongoDB. Vacío: puede arrancar.
 */
export function stagingProblems(profile, env, databaseName) {
  const problems = [];
  if (!STAGING_PROFILES.includes(profile)) return [`Perfil de staging desconocido: ${profile}`];
  if (profile === "azure-produccion") {
    if (env.RAWENERGY_DEPLOYMENT !== profile) problems.push("Entorno de producción no confirmado");
    if (databaseName !== PRODUCTION_DATABASE) problems.push(`Producción solo admite la base ${PRODUCTION_DATABASE}`);
    if (env.NODE_ENV !== "production") problems.push("Producción exige NODE_ENV=production");
    if (!env.AUTH_TOKEN_SECRET || env.AUTH_TOKEN_SECRET.length < 32) problems.push("Falta un AUTH_TOKEN_SECRET propio de al menos 32 caracteres");
    if (env.MAIL_MODE === "simulated") problems.push("Producción no admite el correo simulado");
    if (env.CLIENT_IP_HEADER) problems.push("Azure no está detrás de Cloudflare: no definir CLIENT_IP_HEADER");
    return problems;
  }
  if (env.RAWENERGY_DEPLOYMENT !== profile) problems.push("Entorno de staging no confirmado");
  if (!/^rawenergy_stage_[a-z0-9_]+$/.test(databaseName ?? "")) problems.push("Solo se admite una base rawenergy_stage_* dedicada");
  if (env.NODE_ENV !== "production" || env.STAFF_MFA !== "required") problems.push("Faltan controles obligatorios de staging");
  if (DISALLOWED.some(key => env[key])) problems.push("Staging no admite canales, datos bancarios ni cabeceras heredadas de producción");
  if (env.STORE_WHATSAPP !== "") problems.push("WhatsApp debe estar desactivado en staging");
  if (!env.AUTH_TOKEN_SECRET || !env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) problems.push("Faltan credenciales independientes de staging");
  if (profile === "azure-staging") {
    if (env.CUSTOMER_ACCOUNTS !== "off") problems.push("Faltan controles obligatorios de staging");
  } else {
    if (env.MAIL_MODE !== "simulated") problems.push("El piloto de cuentas exige MAIL_MODE=simulated");
    if (!["on", "off"].includes(env.CUSTOMER_ACCOUNTS)) problems.push("CUSTOMER_ACCOUNTS debe ser on u off de forma explícita");
    // Datos sintéticos: la copia de Atlas (rawenergy_stage_copy_*) tiene clientes reales.
    if (!/^rawenergy_stage_cuentas_[a-z0-9_]+$/.test(databaseName ?? "")) problems.push("El piloto de cuentas solo admite una base sintética rawenergy_stage_cuentas_*");
  }
  return [...new Set(problems)];
}
