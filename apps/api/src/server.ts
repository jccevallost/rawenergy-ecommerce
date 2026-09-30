import { supplyService } from "./services/supply.service.js";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { auditService } from "./services/audit.service.js";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express5";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { notificationOutbox } from "./services/outbox.service.js";
import depthLimit from "graphql-depth-limit";
import { env } from "./config/env.js";
import { resolvers } from "./graphql/resolvers.js";
import { typeDefs } from "./graphql/typeDefs.js";
import { operationWidthRule } from "./graphql/validationRules.js";
import { authService } from "./services/auth.service.js";
import { mediaService, MAX_MEDIA_BYTES } from "./services/media.service.js";
import { productService } from "./services/product.service.js";
import { campaignService } from "./services/campaign.service.js";
import { reservationService } from "./services/reservation.service.js";

const app = express();
const apollo = new ApolloServer({
  typeDefs,
  resolvers,
  validationRules: [depthLimit(4), operationWidthRule],
  formatError: (formattedError) => env.NODE_ENV === "production"
    ? { message: formattedError.message, extensions: { code: formattedError.extensions?.code } }
    : formattedError
});

try {
  const database = await productService.connect(env.MONGODB_URI);
  if(database.mode === "mongodb") await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  authService.setPersistence(database.mode === "mongodb");
  await authService.bootstrapAdmin();
  await supplyService.bootstrap();
  await campaignService.bootstrap();
  const repriced = await productService.refreshPriceRanges();
  if (repriced) console.info(`[api] rango de precio vendible actualizado en ${repriced} productos`);
  console.info(`[api] persistence=${database.mode}`);
} catch (error) {
  // El modo demo es una comodidad de desarrollo. En produccion serviria un
  // catalogo inventado y perderia cada pedido al reiniciar, asi que es mejor
  // no arrancar y que el error se vea en el despliegue.
  if (env.isProduction || env.MONGODB_URI) {
    console.error("[api] No se pudo conectar a MongoDB", error);
    throw error;
  }
  authService.setPersistence(false);
  await authService.bootstrapAdmin();
  await supplyService.bootstrap();
  await campaignService.bootstrap();
  console.warn("[api] MongoDB no disponible; se usarán datos demo en memoria", error);
}

await apollo.start();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});
// Render y Netlify terminan TLS por delante: sin esto req.protocol dice "http"
// y las URL de las imagenes saldrian mal formadas.
app.set("trust proxy", 1);
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Montado sobre la ruta, no sobre el POST: asi tambien responde el preflight
// OPTIONS que el navegador manda antes de subir desde otro origen.
app.use("/media", cors({ origin: env.corsOrigins }));

// Las fotos se guardan aparte del producto y se sirven por su hash, que no
// cambia nunca: por eso se pueden cachear como inmutables.
app.get("/media/:id", async (req, res) => {
  const file = await mediaService.get(String(req.params.id), req.query.size === "thumb");
  if (!file) return res.status(404).json({ error: "No encontrado" });
  res.setHeader("Content-Type", file.contentType);
  const etag = `"${req.params.id}${req.query.size === "thumb" ? "-thumb" : ""}"`;
  res.setHeader("ETag", etag);
  if (req.headers["if-none-match"] === etag) return res.status(304).end();
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.send(file.data);
});

app.post("/media",
  rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: "draft-7", legacyHeaders: false }),
  express.raw({ type: mediaService.allowedList, limit: MAX_MEDIA_BYTES }),
  async (req, res) => {
    const user = await authService.me(req.headers.authorization);
    if (!user || !["ADMIN", "CATALOG"].includes(user.role)) return res.status(401).json({ error: "Solo un administrador puede subir imagenes" });
    const contentType = req.headers["content-type"]?.split(";")[0]?.trim() ?? "";
    if (!mediaService.isAllowed(contentType)) {
      return res.status(415).json({ error: `Formato no permitido. Se aceptan: ${mediaService.allowedList.join(", ")}` });
    }
    try {
      const saved = await auditService.run({ user, ip: req.ip, requestId: randomUUID() }, "uploadMedia", "media", "", { contentType, bytes: req.body?.length }, null, () => mediaService.save(req.body as Buffer, contentType));
      const base = env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`;
      return res.status(201).json({ ...saved, url: `${base}/media/${saved.id}` });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "No se pudo guardar la imagen" });
    }
  }
);
// La respuesta imita un error GraphQL para que la tienda pueda explicar la espera
// en lugar de mostrar un fallo de conexion. CORS va antes: sin sus cabeceras el
// navegador descarta el 429 y la tienda solo ve un error de red.
const graphqlRateLimited = { errors: [{ message: "Demasiadas solicitudes seguidas. Espera un minuto y vuelve a intentarlo.", extensions: { code: "RATE_LIMITED", retryAfter: 60 } }] };
app.use("/graphql",
  // maxAge: el navegador reutiliza la verificación previa 10 min en vez de repetirla en cada consulta.
  cors({ origin: env.corsOrigins, maxAge: 600 }),
  // El personal con sesión válida no consume el cupo por IP: en el local comparte
  // red con los clientes. Los límites por operación (acceso, pedidos) siguen aplicando.
  rateLimit({ windowMs: 60_000, limit: env.GRAPHQL_RATE_LIMIT_PER_MINUTE, standardHeaders: "draft-7", legacyHeaders: false, message: graphqlRateLimited,
    skip: async (req) => {
      if (!req.headers.authorization) return false;
      const user = await authService.me(req.headers.authorization).catch(() => undefined);
      // Si la consulta falla, el contexto de GraphQL la repite y responde el error real.
      if (user !== undefined) (req as typeof req & { authUser?: unknown }).authUser = user;
      return Boolean(user && user.role !== "CUSTOMER");
    } }),
  express.json({ limit: "10mb" }),
  expressMiddleware(apollo, {
    context: async ({ req }) => {
      const checked = req as typeof req & { authUser?: Awaited<ReturnType<typeof authService.me>> };
      return { user: "authUser" in checked ? checked.authUser ?? null : await authService.me(req.headers.authorization), requestId: randomUUID(), ip: req.ip };
    }
  })
);

const server = app.listen(env.PORT, () => console.info(`[api] http://localhost:${env.PORT}/graphql`));
// Cada 5 minutos cancela los pedidos que superaron la reserva sin pago y los
// contra entrega sin confirmar por WhatsApp (4 h, C36). Con
// varias instancias es seguro: el cambio de estado es condicional y se omite si ya ocurrió.
const expireUnpaid = () => reservationService.expire()
  .then(count => { if (count) console.info(`[api] ${count} pedido(s) sin pago cancelado(s) por vencimiento de reserva`); })
  .catch(error => console.error("[api] No se pudo revisar el vencimiento de pedidos", error));
const reservationTimer = setInterval(expireUnpaid, 5 * 60_000);
reservationTimer.unref();
void expireUnpaid();
// Avisos pendientes: reintentos y los que dejó sin enviar un proceso anterior.
notificationOutbox.start();
const shutdown = async () => {
  clearInterval(reservationTimer);
  notificationOutbox.stop();
  server.close();
  await apollo.stop();
  await notificationOutbox.drain();
  await productService.disconnect();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
