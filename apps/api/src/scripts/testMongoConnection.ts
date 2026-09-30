import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error("[mongo] MONGODB_URI no está definida en apps/api/.env");
  process.exit(1);
}

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8_000 });
  const database = mongoose.connection.db;
  if (!database) throw new Error("MongoDB no devolvió una base activa");
  await database.admin().ping();
  console.info(`[mongo] conexión correcta; database=${database.databaseName}`);
  await mongoose.disconnect();
} catch (error) {
  const details = error as { code?: number; codeName?: string; message?: string };
  console.error(`[mongo] conexión rechazada; code=${details.codeName ?? details.code ?? "UNKNOWN"}; message=${details.message ?? "sin detalle"}`);
  process.exit(1);
}
