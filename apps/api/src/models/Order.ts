import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema, model, models } = mongoose;

const orderCustomerSchema = new Schema({
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  province: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  reference: { type: String, default: "", trim: true },
  // Identificación para la factura: CEDULA, RUC o PASAPORTE.
  idType: { type: String, default: "" },
  idNumber: { type: String, default: "", trim: true }
}, { _id: false });

const orderItemSchema = new Schema({
  allocations: { type: [{ warehouseId: String, lot: String, expiresOn: String, quantity: Number, unitCost: { type: Number, default: null }, _id: false }], default: [] },
  unitCost: { type: Number, default: null },
  categories: { type: [{ name: String, slug: String, _id: false }], default: undefined },
  productId: { type: String, required: true },
  variantSku: { type: String, required: true },
  title: { type: String, required: true },
  variantLabel: { type: String, required: true },
  image: { type: String, default: "" },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  lineTotal: { type: Number, required: true, min: 0 },
  // Parte del descuento del pedido que corresponde a esta línea (C46).
  discount: { type: Number, default: 0, min: 0 }
}, { _id: false });

const orderSchema = new Schema({
  requestKey: { type: String },
  requestFingerprint: String,
  history: { type: [{ from: String, to: String, at: Date, actorId: String, reason: String, _id: false }], default: [] },
  returnInfo: { type: new Schema({ at: Date, reason: String, restocked: Boolean }, { _id: false }), default: null },
  refund: { type: new Schema({ at: Date, reason: String, reference: String, amount: Number }, { _id: false }), default: null },
  orderNumber: { type: String, required: true, unique: true, index: true },
  userId: { type: String, default: null },
  customer: { type: orderCustomerSchema, required: true },
  items: { type: [orderItemSchema], required: true, validate: [(value: unknown[]) => value.length > 0, "La orden necesita productos"] },
  shippingMethod: { type: String, enum: ["EXPRESS_QUITO_VALLES", "SERVIENTREGA_NATIONAL"], required: true },
  paymentMethod: { type: String, enum: ["BANK_TRANSFER", "CASH_ON_DELIVERY"], default: "BANK_TRANSFER" },
  status: {
    type: String,
    enum: ["PENDING_PAYMENT", "PAYMENT_REVIEW", "PAID", "PREPARING", "SHIPPED", "COMPLETED", "CANCELLED", "RETURNED"],
    default: "PENDING_PAYMENT",
    index: true
  },
  subtotal: { type: Number, required: true, min: 0 },
  // Descuento de bienvenida aplicado (C46); el total ya lo descuenta.
  discount: { type: new Schema({ code: String, percent: Number, amount: Number }, { _id: false }), default: null },
  shippingFee: { type: Number, default: 0, min: 0 },
  total: { type: Number, required: true, min: 0 },
  notes: { type: String, default: "", trim: true },
  paymentReference: { type: String, default: "", trim: true },
  // Sigue descontado hasta cancelar antes del despacho o registrar devolución.
  // Las reservas físicas se obtienen solo de estados anteriores al despacho.
  paidAt: { type: Date, default: null },
  // Contra entrega confirmada por WhatsApp (C36) y ubicación que envió el cliente.
  confirmedAt: { type: Date, default: null },
  deliveryLocation: { type: String, default: "", trim: true },
  stockReserved: { type: Boolean, default: true },
  transitionId: { type: String, default: null }
}, { timestamps: true });

orderSchema.index({ createdAt: -1, status: 1 });
orderSchema.index({ requestKey: 1 }, { unique: true, sparse: true });

export type OrderDocument = InferSchemaType<typeof orderSchema>;
export const OrderModel = (models.Order ?? model<OrderDocument>("Order", orderSchema)) as Model<OrderDocument>;
