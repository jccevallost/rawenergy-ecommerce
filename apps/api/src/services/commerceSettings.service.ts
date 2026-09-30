import mongoose from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { operationContext, registerMemoryStore, unitOfWork } from "../lib/unitOfWork.js";

// Reglas comerciales que el administrador edita en el panel: cuenta para
// transferencias, tarifas de envío, envío gratis y pago contra entrega. El
// servidor las aplica al calcular carritos y crear pedidos; la tienda solo las muestra.
export const shippingMethods = ["EXPRESS_QUITO_VALLES", "SERVIENTREGA_NATIONAL"] as const;
export type ShippingMethod = typeof shippingMethods[number];
export const paymentMethods = ["BANK_TRANSFER", "CASH_ON_DELIVERY"] as const;
export type PaymentMethod = typeof paymentMethods[number];

const money = z.number().nonnegative().max(100000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Usa hasta dos decimales");
export const commerceInputSchema = z.object({
  bank: z.object({
    name: z.string().trim().min(2).max(80),
    accountType: z.string().trim().min(2).max(40),
    accountNumber: z.string().trim().regex(/^[0-9][0-9-]{4,29}$/, "Número de cuenta: solo dígitos y guiones"),
    holder: z.string().trim().min(3).max(80),
    document: z.string().trim().max(20).default("")
  }).strict(),
  shippingFees: z.object({ EXPRESS_QUITO_VALLES: money, SERVIENTREGA_NATIONAL: money }).strict(),
  freeShippingThreshold: money.refine(value => value > 0, "El envío gratis necesita un monto mayor a cero"),
  // Métodos con envío gratis al llegar al umbral; vacío = nunca gratis.
  freeShippingMethods: z.array(z.enum(shippingMethods)).max(2).refine(list => new Set(list).size === list.length, "Método repetido"),
  // confirmHours: plazo para confirmar por WhatsApp; después se cancela solo (C36).
  cashOnDelivery: z.object({ enabled: z.boolean(), expressOnly: z.boolean(), minimumSubtotal: money, confirmHours: z.number().int().min(1).max(72) }).strict(),
  // Apagado: la web no muestra la cuenta; el cliente la recibe por WhatsApp.
  showBankDetails: z.boolean(),
  // Descuento de bienvenida con código (C46): porcentaje sobre los productos,
  // solo en la primera compra de cada persona (documento, celular y correo).
  welcomeDiscount: z.object({
    enabled: z.boolean(),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{4,20}$/, "Código: 4 a 20 letras, números o guiones"),
    percent: z.number().int().min(1).max(50),
    minimumSubtotal: money,
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").nullable(),
    // Encendido: la tienda anuncia el código; apagado: se reparte por otros canales.
    showOnStore: z.boolean()
  }).strict()
}).strict();

export type CommerceInput = z.infer<typeof commerceInputSchema>;
export type CommerceSettings = CommerceInput & { revision: number; updatedByName: string; updatedAt: string | null };

// Valores iniciales confirmados por el propietario el 2026-09-27: envío express
// gratis desde USD 75 (el nacional nunca), contra entrega sin mínimo y datos de
// transferencia por WhatsApp. Las variables
// BANK_* siguen teniendo prioridad si están definidas y no hay nada guardado.
const initialBank = { name: "Banco Pichincha", accountType: "Ahorros", accountNumber: "4755789300", holder: "Juan Cevallos", document: "" };

export function defaultCommerceSettings(): CommerceSettings {
  const fromEnv = env.bank.name && env.bank.accountNumber && env.bank.holder;
  return {
    bank: fromEnv ? { name: env.bank.name!, accountType: env.bank.accountType ?? "", accountNumber: env.bank.accountNumber!, holder: env.bank.holder!, document: env.bank.document ?? "" } : initialBank,
    shippingFees: { EXPRESS_QUITO_VALLES: 4, SERVIENTREGA_NATIONAL: 5 },
    freeShippingThreshold: env.FREE_SHIPPING_THRESHOLD,
    freeShippingMethods: ["EXPRESS_QUITO_VALLES"],
    cashOnDelivery: { enabled: true, expressOnly: true, minimumSubtotal: 0, confirmHours: 4 },
    showBankDetails: false,
    // Decisión del propietario (2026-09-29): 10 % para clientes nuevos con código.
    welcomeDiscount: { enabled: true, code: "BIENVENIDA10", percent: 10, minimumSubtotal: 0, endsOn: null, showOnStore: true },
    revision: 0, updatedByName: "", updatedAt: null
  };
}

const schema = new mongoose.Schema({
  _id: String, bank: Object, shippingFees: Object, freeShippingThreshold: Number, freeShippingMethods: [String], cashOnDelivery: Object, showBankDetails: Boolean, welcomeDiscount: Object,
  revision: { type: Number, default: 0 }, updatedByName: String
}, { timestamps: true, minimize: false });
export const SettingsModel = (mongoose.models.CommerceSettings ?? mongoose.model("CommerceSettings", schema, "settings")) as mongoose.Model<mongoose.InferSchemaType<typeof schema>>;

let memory: CommerceSettings | null = null;
registerMemoryStore(() => memory, value => { memory = value; });
const mongo = () => mongoose.connection.readyState === 1;
const DOC_ID = "commerce";

export const freeShippingApplies = (settings: CommerceSettings, method: ShippingMethod, subtotal: number) =>
  settings.freeShippingMethods.includes(method) && subtotal >= settings.freeShippingThreshold;
export const shippingFee = (settings: CommerceSettings, method: ShippingMethod, subtotal: number) =>
  freeShippingApplies(settings, method, subtotal) ? 0 : settings.shippingFees[method];

/** Motivo por el que un método de pago no aplica, o null si se permite. */
export function paymentRestriction(settings: CommerceSettings, method: PaymentMethod, shipping: ShippingMethod, subtotal: number): string | null {
  if (method === "BANK_TRANSFER") return null;
  const cod = settings.cashOnDelivery;
  if (!cod.enabled) return "El pago contra entrega no está disponible por ahora.";
  if (cod.expressOnly && shipping !== "EXPRESS_QUITO_VALLES") return "El pago contra entrega solo está disponible con envío express en Quito y Valles.";
  if (cod.minimumSubtotal > 0 && subtotal <= cod.minimumSubtotal) return `El pago contra entrega está disponible en compras de más de $${cod.minimumSubtotal.toFixed(2)}.`;
  return null;
}

export const commerceSettingsService = {
  async get(): Promise<CommerceSettings> {
    if (mongo()) {
      const row = await SettingsModel.findById(DOC_ID).lean();
      if (!row) return defaultCommerceSettings();
      const { bank, shippingFees, freeShippingThreshold, freeShippingMethods, cashOnDelivery, showBankDetails, welcomeDiscount, revision, updatedByName, updatedAt } = row as unknown as Partial<CommerceSettings> & CommerceSettings & { updatedAt: Date };
      // Guardados antes de C31: se completan con las reglas vigentes del propietario.
      const initial = defaultCommerceSettings();
      return { bank, shippingFees, freeShippingThreshold, freeShippingMethods: freeShippingMethods ?? initial.freeShippingMethods, cashOnDelivery: { ...initial.cashOnDelivery, ...cashOnDelivery }, showBankDetails: showBankDetails ?? initial.showBankDetails, welcomeDiscount: { ...initial.welcomeDiscount, ...welcomeDiscount }, revision, updatedByName: updatedByName ?? "", updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null };
    }
    return memory ? structuredClone(memory) : defaultCommerceSettings();
  },
  /** Guarda con revisión optimista: dos administradores no se pisan los cambios. */
  async save(raw: unknown, revision: number, actor: { name: string }): Promise<{ settings: CommerceSettings; bankChanged: boolean }> {
    if (!operationContext.getStore()) return unitOfWork(() => this.save(raw, revision, actor));
    const input = commerceInputSchema.parse(raw);
    const current = await this.get();
    if (current.revision !== revision) throw new Error("Otra persona cambió la configuración. Actualiza antes de guardar; tus cambios siguen en el formulario.");
    const settings: CommerceSettings = { ...input, revision: revision + 1, updatedByName: actor.name, updatedAt: new Date().toISOString() };
    if (mongo()) {
      const { updatedAt: _ignored, ...stored } = settings;
      if (revision === 0) {
        try { await SettingsModel.create({ _id: DOC_ID, ...stored }); }
        catch (error) { if ((error as { code?: number }).code === 11000) throw new Error("Otra persona cambió la configuración. Actualiza antes de guardar."); throw error; }
      } else {
        const changed = await SettingsModel.updateOne({ _id: DOC_ID, revision }, { $set: stored });
        if (!changed.matchedCount) throw new Error("Otra persona cambió la configuración. Actualiza antes de guardar.");
      }
    } else memory = settings;
    const bankChanged = JSON.stringify(current.bank) !== JSON.stringify(input.bank);
    return { settings, bankChanged };
  }
};
