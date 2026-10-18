import "dotenv/config";
import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().url().or(z.string().startsWith("mongodb://")).optional(),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:5174"),
  // Valor inicial del envío express gratis; luego se edita en el panel.
  FREE_SHIPPING_THRESHOLD: z.coerce.number().positive().default(75),
  // Comprueba en DNS que el dominio del correo reciba correo. Apagado en pruebas automáticas.
  EMAIL_DOMAIN_CHECK: z.enum(["on", "off"]).optional(),
  // Horas que un pedido sin pago mantiene su stock reservado; después se cancela.
  ORDER_RESERVATION_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  // Peticiones GraphQL por minuto y por IP antes de responder 429.
  GRAPHQL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(10000).default(120),
  // Cabecera con la IP real del visitante que pone el proxy de confianza (antes en Render,
  // Cloudflare: cf-connecting-ip). Sin ella se usa req.ip con `trust proxy` (C60, S02).
  // Solo se define si el proxy sobrescribe la cabecera: si el cliente pudiera enviarla, la falsificaría.
  CLIENT_IP_HEADER: z.string().regex(/^[a-z0-9-]+$/i).optional(),
  // Días que se conserva la bitácora de auditoría (contiene datos personales; LOPDP).
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(365),
  // Cuentas de clientes en la tienda (CLI-01). Decisión del propietario del 14/10/2026: retiradas por
  // ahora; se compra y se consulta el pedido sin cuenta. «on» las reactiva sin borrar ni migrar datos.
  // En las pruebas automáticas quedan activas porque ejercitan esas funciones conservadas.
  CUSTOMER_ACCOUNTS: z.enum(["on", "off"]).default(process.env.NODE_ENV === "test" ? "on" : "off"),
  // Segundo factor del personal (SEG-01). Obligatorio en producción: sin él la sesión solo sirve para
  // activarlo. En desarrollo y pruebas queda opcional para no frenar la demo local.
  // VER-01: versión mínima por plataforma de cliente, en JSON. Vacío: sin mínimas.
  MIN_CLIENT_VERSIONS: z.string().max(500).optional(),
  STAFF_MFA: z.enum(["required", "optional"]).default(process.env.NODE_ENV === "production" ? "required" : "optional"),
  // Pedidos sin pagar o sin confirmar que una misma persona (documento, celular o correo) puede tener a la vez.
  // En las pruebas automáticas se sube a 20: muchas crean varios pedidos del mismo cliente de prueba.
  // Cloudflare Turnstile (C70): CAPTCHA en registro y pedidos nuevos si están las dos claves.
  TURNSTILE_SITE_KEY: z.string().min(10).max(100).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(10).max(200).optional(),
  MAX_PENDING_ORDERS_PER_CUSTOMER: z.coerce.number().int().min(1).max(20).default(process.env.NODE_ENV === "test" ? 20 : 2),
  AUTH_TOKEN_SECRET: z.string().min(32).optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_NAME: z.string().min(2).max(80).optional(),
  // Dominio publico de la API. Se usa para construir las URL de las imagenes
  // servidas desde /media. Si no se define se deduce de la peticion.
  ADMIN_APP_URL: z.string().url().optional(),
  PUBLIC_API_URL: z.string().url().optional(),

  // Correo saliente por SMTP. Sirve con Resend, Brevo o cualquier proveedor:
  // solo cambian estas variables. Si faltan, la tienda funciona igual y los
  // envios quedan anotados en el log en vez de salir.
  SMTP_HOST: z.string().min(3).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(3).optional(),
  // CU02, decisión del propietario del 16/10/2026: en la fase de cuentas la verificación de correo es
  // simulada. «simulated» guarda los mensajes en un buzón de prueba en memoria en vez de enviarlos;
  // solo se admite fuera de producción o en el perfil de staging de cuentas (ver envProblems).
  MAIL_MODE: z.enum(["smtp", "simulated"]).default("smtp"),
  // Perfil de despliegue que fija el arranque de staging (scripts/staging-guards.mjs).
  RAWENERGY_DEPLOYMENT: z.string().max(60).optional(),
  // A donde llegan los avisos de pedido nuevo. Si se omite, se usa ADMIN_EMAIL.
  MAIL_OPERATOR: z.string().email().optional(),
  STORE_NAME: z.string().min(2).max(60).default("RawEnergy EC"),
  STORE_URL: z.string().url().optional(),
  // WhatsApp de la tienda (público): confirmar contra entrega, recibir comprobantes y atención.
  // Por omisión el número del propietario (C74), para que la compra nunca quede sin este paso;
  // vacío lo apaga.
  STORE_WHATSAPP: z.string().max(40).default("593983368127").transform(value => value.trim() || undefined),
  // Identidad legal para las políticas (responsable del tratamiento, LOPDP).
  STORE_LEGAL_NAME: z.string().min(2).max(120).optional(),
  STORE_RUC: z.string().regex(/^\d{13}$/, "El RUC tiene 13 dígitos").optional(),
  STORE_ADDRESS: z.string().min(5).max(200).optional(),
  STORE_CONTACT_EMAIL: z.string().email().optional(),

  // Datos para la transferencia. Si estan, viajan en el correo de confirmacion
  // para que el cliente pueda pagar sin esperar a que alguien le escriba.
  BANK_NAME: z.string().max(80).optional(),
  BANK_ACCOUNT_TYPE: z.string().max(40).optional(),
  BANK_ACCOUNT_NUMBER: z.string().max(40).optional(),
  BANK_HOLDER: z.string().max(80).optional(),
  BANK_DOCUMENT: z.string().max(40).optional(),

  // Aviso al operador por Telegram. No necesita dominio ni verificacion, y el
  // mensaje llega al telefono en el momento.
  TELEGRAM_BOT_TOKEN: z.string().min(20).optional(),
  TELEGRAM_CHAT_ID: z.string().min(1).max(40).optional(),
  // Solo para pruebas: permite apuntar a un servidor simulado.
  TELEGRAM_API_URL: z.string().url().optional()
});

/** Combinaciones que el esquema por campo no detecta. Vacío: configuración coherente. */
export function envProblems(data: z.infer<typeof envSchema>) {
  const problems: string[] = [];
  if (data.MAIL_MODE === "simulated") {
    if (data.SMTP_HOST) problems.push("MAIL_MODE=simulated no admite SMTP_HOST: elige un solo canal de correo");
    // Un buzón simulado en producción real dejaría a los clientes sin verificación ni recuperación.
    if (data.NODE_ENV === "production" && data.RAWENERGY_DEPLOYMENT !== "azure-staging-cuentas") problems.push("El correo simulado solo se admite en el perfil azure-staging-cuentas");
  }
  return problems;
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) throw new Error(`Configuración inválida: ${parsed.error.message}`);
const problems = envProblems(parsed.data);
if (problems.length) throw new Error(`Configuración inválida: ${problems.join("; ")}`);

const isProduction = parsed.data.NODE_ENV === "production";

// En produccion no se arranca con secretos de desarrollo: un token firmado con el
// secreto por defecto lo puede falsificar cualquiera que lea el repositorio, y una
// cuenta admin con contraseña conocida es una puerta abierta. ADMIN_PASSWORD solo
// hace falta para crear la primera cuenta de administración; despues se puede
// quitar (C60, S11) y bootstrapAdmin se niega a arrancar si no hay ninguna.
if (isProduction) {
  const missing: string[] = [];
  if (!parsed.data.AUTH_TOKEN_SECRET) missing.push("AUTH_TOKEN_SECRET (minimo 32 caracteres)");
  if (!parsed.data.MONGODB_URI) missing.push("MONGODB_URI");
  if (missing.length) {
    throw new Error(`Faltan variables obligatorias en produccion: ${missing.join(", ")}`);
  }
}

export const env = {
  ...parsed.data,
  PUBLIC_API_URL: parsed.data.PUBLIC_API_URL?.replace(/\/$/, "") ?? "",
  isProduction,
  authTokenSecret: parsed.data.AUTH_TOKEN_SECRET ?? "rawenergy-dev-secret-change-me",
  adminEmail: (parsed.data.ADMIN_EMAIL ?? "admin@rawenergy.ec").toLowerCase(),
  adminPassword: parsed.data.ADMIN_PASSWORD ?? (isProduction ? "" : "Admin123!"),
  adminName: parsed.data.ADMIN_NAME ?? "Andrea Admin",
  telegramApiUrl: (parsed.data.TELEGRAM_API_URL ?? "https://api.telegram.org").replace(/\/$/, ""),
  mailOperator: parsed.data.MAIL_OPERATOR ?? (parsed.data.ADMIN_EMAIL ?? "admin@rawenergy.ec").toLowerCase(),
  mailFrom: parsed.data.MAIL_FROM ?? parsed.data.SMTP_USER ?? "",
  bank: {
    name: parsed.data.BANK_NAME ?? "",
    accountType: parsed.data.BANK_ACCOUNT_TYPE ?? "",
    accountNumber: parsed.data.BANK_ACCOUNT_NUMBER ?? "",
    holder: parsed.data.BANK_HOLDER ?? "",
    document: parsed.data.BANK_DOCUMENT ?? ""
  },
  // En producción se respeta la lista blanca de CORS_ORIGINS.
  // En desarrollo se refleja cualquier origen local para no pelear con el
  // puerto en el que corra Vite (apps/web, apps/admin).
  emailDomainCheck: parsed.data.EMAIL_DOMAIN_CHECK ?? (parsed.data.NODE_ENV === "test" ? "off" : "on"),
  corsOrigins: isProduction
    ? parsed.data.CORS_ORIGINS.split(",").map((origin) => origin.trim())
    : true
};
