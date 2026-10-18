import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

// CU12: solicitud del cliente para que el equipo cancele un pedido que ya no puede cancelar solo (confirmado,
// con comprobante o pago). Una sola pendiente por pedido; la decisión lleva motivo público y nota interna aparte.
const cancellationRequestSchema = new Schema({
  _id: { type: String, required: true },
  orderId: { type: String, required: true },
  orderNumber: { type: String, required: true },
  userId: { type: String, required: true, index: true },
  reason: { type: String, required: true },
  note: { type: String, default: "" },
  status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING", index: true },
  publicNote: { type: String, default: "" },
  internalNote: { type: String, default: "" },
  decidedBy: { type: String, default: null },
  decidedAt: { type: Date, default: null },
  revision: { type: Number, default: 0 }
}, { timestamps: true });
cancellationRequestSchema.index({ orderId: 1 }, { unique: true, partialFilterExpression: { status: "PENDING" } });

export type CancellationRequestDocument = InferSchemaType<typeof cancellationRequestSchema>;
export const CancellationRequestModel = (models.CancellationRequest ?? model<CancellationRequestDocument>("CancellationRequest", cancellationRequestSchema)) as Model<CancellationRequestDocument>;
