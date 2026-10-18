import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["CUSTOMER", "CATALOG", "WAREHOUSE", "MANAGER", "STORE_MANAGER", "ADMIN"], default: "CUSTOMER", index: true },
  status: { type: String, enum: ["ACTIVE", "BLOCKED"], default: "ACTIVE" },
  sessions: { type: [{ id: String, createdAt: Date, expiresAt: Date, _id: false }], default: [] },
  resetHash: String, resetExpiresAt: Date, resetRequestedAt: Date,
  // CU04: posesión del correo del cliente. Solo se guarda el hash de cada enlace; vencen y sirven una vez.
  emailVerifiedAt: { type: Date, default: null },
  verifyHash: String, verifyExpiresAt: Date, verifyRequestedAt: Date,
  // Cambio de correo pendiente: el correo vigente no cambia hasta confirmar el nuevo.
  pendingEmail: String, emailChangeHash: String, emailChangeExpiresAt: Date, emailChangeRequestedAt: Date,
  // CU11: cancelaciones directas seguidas (se reinicia con un pedido pagado o completado) y motivo del bloqueo.
  customerCancellations: { type: Number, default: 0 },
  blockedReason: { type: String, default: null },
  accessRevision: { type: Number, default: 0 },
  sessionVersion: { type: Number, default: 0 },
  lastLoginAt: Date,
  // Segundo factor (C69): secreto cifrado, alta pendiente, último paso usado y códigos de recuperación (hash).
  totpEnabled: { type: Boolean, default: false },
  totpSecret: String,
  totpPending: String,
  totpLastStep: { type: Number, default: -1 },
  totpRecovery: { type: [String], default: [] }
}, { timestamps: true, optimisticConcurrency: true });

export type UserDocument = InferSchemaType<typeof userSchema>;
export const UserModel = (models.User ?? model<UserDocument>("User", userSchema)) as Model<UserDocument>;
