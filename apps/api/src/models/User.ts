import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["CUSTOMER", "CATALOG", "WAREHOUSE", "MANAGER", "ADMIN"], default: "CUSTOMER", index: true },
  status: { type: String, enum: ["ACTIVE", "BLOCKED"], default: "ACTIVE" },
  sessions: { type: [{ id: String, createdAt: Date, expiresAt: Date, _id: false }], default: [] },
  resetHash: String, resetExpiresAt: Date, resetRequestedAt: Date,
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
