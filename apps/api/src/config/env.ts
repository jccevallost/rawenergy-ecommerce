import "dotenv/config";
import { z } from "zod";

const schema = z.object({
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
  // A donde llegan los avisos de pedido nuevo. Si se omite, se usa ADMIN_EMAIL.
  MAIL_OPERATOR: z.string().email().optional(),
  STORE_NAME: z.string().min(2).max(60).default("RawEnergy EC"),
  STORE_URL: z.string().url().optional(),
  STORE_WHATSAPP: z.string().max(40).optional(),
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

const parsed = schema.safeParse(process.env);
if (!parsed.success) throw new Error(`Configuración inválida: ${parsed.error.message}`);

const isProduction = parsed.data.NODE_ENV === "production";

// En produccion no se arranca con secretos de desarrollo: un token firmado con el
// secreto por defecto lo puede falsificar cualquiera que lea el repositorio, y una
// cuenta admin con contraseña conocida es una puerta abierta.
if (isProduction) {
  const missing: string[] = [];
  if (!parsed.data.AUTH_TOKEN_SECRET) missing.push("AUTH_TOKEN_SECRET (minimo 32 caracteres)");
  if (!parsed.data.ADMIN_PASSWORD) missing.push("ADMIN_PASSWORD");
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
  adminPassword: parsed.data.ADMIN_PASSWORD ?? "Admin123!",
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
