import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

// CU11: identidades (documento, celular, correo normalizados, como `personKeys`) de una cuenta bloqueada por
// cancelaciones seguidas. Rechazan compras como invitado y consultas públicas hasta el desbloqueo manual.
// `_id` es la clave: una identidad solo puede estar registrada una vez.
const blockedIdentitySchema = new Schema({
  _id: { type: String, required: true },
  userId: { type: String, required: true, index: true }
}, { timestamps: true });

export type BlockedIdentityDocument = InferSchemaType<typeof blockedIdentitySchema>;
export const BlockedIdentityModel = (models.BlockedIdentity ?? model<BlockedIdentityDocument>("BlockedIdentity", blockedIdentitySchema)) as Model<BlockedIdentityDocument>;
