import mongoose from "mongoose";
import { GraphQLError } from "graphql";
import { registerMemoryStore } from "../lib/unitOfWork.js";
import type { CommerceSettings } from "./commerceSettings.service.js";

// Descuento de bienvenida (C46). El código se evalúa en el carrito sin mirar quién
// compra (no se revela si una cédula ya compró); al crear el pedido se exige que
// documento, celular y correo no tengan pedidos vigentes y se reserva el beneficio
// una vez por cada uno. La reserva es un documento con _id único: dos pedidos
// simultáneos de la misma persona no pueden llevarse el descuento los dos.
const schema = new mongoose.Schema({ _id: String, code: String, orderId: String, orderNumber: String }, { timestamps: true });
export const RedemptionModel = (mongoose.models.DiscountRedemption ?? mongoose.model("DiscountRedemption", schema, "discountRedemptions")) as mongoose.Model<{ _id: string; code: string; orderId: string; orderNumber: string }>;

type Redemption = { _id: string; code: string; orderId: string; orderNumber: string };
let memory: Redemption[] = [];
registerMemoryStore(() => memory, value => { memory = value; });
const mongo = () => mongoose.connection.readyState === 1;
const ecuadorToday = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
const round = (value: number) => Math.round(value * 100) / 100;

export type AppliedDiscount = { code: string; percent: number; amount: number };
export type CodeCheck = { discount: AppliedDiscount | null; message: string | null };

export const normalizeCode = (value?: string | null) => (value ?? "").trim().toUpperCase();

/** Estado del código para un subtotal de productos, sin datos de la persona. */
export function evaluateCode(settings: CommerceSettings, rawCode: string | null | undefined, subtotal: number): CodeCheck {
  const code = normalizeCode(rawCode);
  if (!code) return { discount: null, message: null };
  const rule = settings.welcomeDiscount;
  if (!rule.enabled || code !== rule.code || (rule.endsOn && ecuadorToday() > rule.endsOn)) return { discount: null, message: `El código ${code} no existe o ya no está vigente.` };
  if (rule.minimumSubtotal > 0 && subtotal < rule.minimumSubtotal) return { discount: null, message: `El código ${code} aplica en compras de productos desde $${rule.minimumSubtotal.toFixed(2)}.` };
  const amount = Math.min(subtotal, Math.round(subtotal * rule.percent) / 100);
  return { discount: { code, percent: rule.percent, amount }, message: `${rule.percent} % en tu primera compra. Se confirma al registrar el pedido.` };
}

/** Reparte el descuento entre las líneas (al centavo) para que los reportes por producto queden netos. */
export function prorate(lineTotals: number[], amount: number): number[] {
  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  if (!amount || !subtotal) return lineTotals.map(() => 0);
  const shares = lineTotals.map(value => Math.floor(value / subtotal * amount * 100) / 100);
  let rest = round(amount - shares.reduce((sum, value) => sum + value, 0));
  const order = lineTotals.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value);
  for (let i = 0; rest > 0.0001; i = (i + 1) % order.length) { shares[order[i]!.index] = round(shares[order[i]!.index]! + 0.01); rest = round(rest - 0.01); }
  return shares;
}

/** Claves de la persona: una reserva por documento, celular y correo. */
export const personKeys = (customer: { idNumber: string; phone: string; email: string }) =>
  [`doc:${customer.idNumber.trim().toUpperCase()}`, `phone:${customer.phone.trim()}`, `email:${customer.email.trim().toLowerCase()}`];

export const notEligible = (code: string) => new GraphQLError(`El código ${code} es solo para la primera compra. Quitamos el descuento: revisa el total y confirma de nuevo.`, { extensions: { code: "DISCOUNT_NOT_ELIGIBLE" } });

export const redemptions = {
  /** Reserva el beneficio para el pedido. Falla si la persona ya lo usó. Debe correr en la misma transacción que crea el pedido. */
  async claim(keys: string[], code: string, orderId: string, orderNumber: string) {
    const rows = keys.map(_id => ({ _id, code, orderId, orderNumber }));
    if (mongo()) {
      try { await RedemptionModel.insertMany(rows, { ordered: true }); }
      catch (error) { if ((error as { code?: number }).code === 11000) throw notEligible(code); throw error; }
      return;
    }
    if (rows.some(row => memory.some(existing => existing._id === row._id))) throw notEligible(code);
    memory.push(...rows);
  },
  /** Un pedido cancelado devuelve el beneficio a la persona. */
  async release(orderId: string) {
    if (mongo()) { await RedemptionModel.deleteMany({ orderId }); return; }
    memory = memory.filter(row => row.orderId !== orderId);
  },
  async taken(keys: string[]) {
    if (mongo()) return (await RedemptionModel.countDocuments({ _id: { $in: keys } })) > 0;
    return memory.some(row => keys.includes(row._id));
  }
};
