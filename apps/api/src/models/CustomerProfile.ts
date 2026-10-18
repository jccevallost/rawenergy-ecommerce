import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

// CU03: perfil del cliente, uno por usuario. `_id` es el id del usuario, así que el índice único de
// `_id` impide dos perfiles para la misma cuenta. Las direcciones van dentro del documento para cambiar
// la predeterminada y su referencia en una sola escritura. Colección nueva: no migra datos existentes.
const addressSchema = new Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  province: { type: String, required: true },
  city: { type: String, required: true },
  address: { type: String, required: true },
  reference: { type: String, default: "" },
  recipientName: { type: String, default: "" },
  recipientPhone: { type: String, default: "" },
  fingerprint: { type: String, required: true },
  createdAt: { type: Date, required: true },
  updatedAt: { type: Date, required: true }
}, { _id: false });

const customerProfileSchema = new Schema({
  _id: { type: String, required: true },
  revision: { type: Number, required: true, default: 1 },
  phone: { type: String, default: "" },
  altPhone: { type: String, default: "" },
  billing: { type: new Schema({ name: String, idType: String, idNumber: String, email: String }, { _id: false }), default: null },
  addresses: { type: [addressSchema], default: [] },
  defaultAddressId: { type: String, default: null }
}, { timestamps: true });

export type CustomerProfileDocument = InferSchemaType<typeof customerProfileSchema>;
export const CustomerProfileModel = (models.CustomerProfile ?? model<CustomerProfileDocument>("CustomerProfile", customerProfileSchema)) as Model<CustomerProfileDocument>;
