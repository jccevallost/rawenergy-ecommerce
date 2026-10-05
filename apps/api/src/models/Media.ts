import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

// El id es el sha256 del archivo: subir dos veces la misma foto no duplica bytes
// y permite servirla como inmutable en el navegador.
const mediaSchema = new Schema({
  _id: { type: String, required: true },
  contentType: { type: String, required: true },
  size: { type: Number, required: true, min: 1 },
  width: Number, height: Number, label: { type: String, default: "" },
  thumbnail: Buffer,
  // 720 px (C64): tarjetas en pantallas de alta densidad; se genera al pedirla la primera vez.
  medium: Buffer,
  data: { type: Buffer, required: true }
}, { timestamps: true, _id: false });

export type MediaDocument = InferSchemaType<typeof mediaSchema>;
export const MediaModel = (models.Media ?? model<MediaDocument>("Media", mediaSchema)) as Model<MediaDocument>;
