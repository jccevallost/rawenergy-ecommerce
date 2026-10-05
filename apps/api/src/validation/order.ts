import { z } from "zod";
import { emailProblem, findCanton, findProvince, identificationProblem, inferIdType, mobileProblem, normalizeIdentification, normalizeMobile } from "../data/ecuador.js";

// Unidades por presentación en un pedido (C60, S04): frena que un solo pedido deje sin
// existencias a los demás mientras espera el pago. Igual que CART_MAX_QUANTITY de la tienda;
// para más unidades el cliente escribe por WhatsApp. Valor por omisión pendiente de confirmar por el propietario.
export const MAX_UNITS_PER_LINE = 20;

export const checkoutInputSchema = z.object({
  expectedTotal: z.number().nonnegative().max(100000000).optional(),
  idempotencyKey: z.string().uuid().optional(),
  // Mismas reglas que la tienda (data/ecuador.ts): la tienda guía, el servidor decide.
  customer: z.object({
    fullName: z.string().trim().min(3).max(100),
    email: z.string().trim().max(120).refine(value => !emailProblem(value), "Escribe un correo válido, por ejemplo nombre@gmail.com."),
    phone: z.string().trim().max(30).refine(value => !mobileProblem(value), "Escribe un celular de 10 dígitos que empiece con 09.").transform(normalizeMobile),
    province: z.string().trim().max(80).refine(value => !!findProvince(value), "Elige una provincia de la lista.").transform(value => findProvince(value)!.province),
    city: z.string().trim().max(80),
    address: z.string().trim().min(8).max(240),
    reference: z.string().trim().max(180).optional().default(""),
    // Identificación obligatoria para la factura (C33, C34): cédula o RUC verificados; pasaporte de extranjeros sin verificar.
    idType: z.enum(["CEDULA", "RUC", "PASAPORTE"]).optional(),
    idNumber: z.string({ required_error: "La identificación es obligatoria para la factura." }).trim().max(30)
  }).superRefine((customer, context) => {
    if (!findCanton(customer.province, customer.city)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["city"], message: "Elige una ciudad de la provincia seleccionada." });
    if (!customer.idNumber) { context.addIssue({ code: z.ZodIssueCode.custom, path: ["idNumber"], message: "La identificación es obligatoria para la factura." }); return; }
    const type = customer.idType ?? inferIdType(customer.idNumber);
    if (!type) { context.addIssue({ code: z.ZodIssueCode.custom, path: ["idType"], message: "Elige el tipo de identificación: cédula, RUC o pasaporte." }); return; }
    const issue = identificationProblem(type, customer.idNumber);
    if (issue) context.addIssue({ code: z.ZodIssueCode.custom, path: ["idNumber"], message: issue });
  }).transform(customer => {
    const idType = customer.idType ?? inferIdType(customer.idNumber)!;
    return { ...customer, city: findCanton(customer.province, customer.city)![0], idType, idNumber: normalizeIdentification(idType, customer.idNumber) };
  }),
  items: z.array(z.object({
    productId: z.string().min(1),
    variantSku: z.string().min(3).max(120),
    quantity: z.number().int().min(1).max(MAX_UNITS_PER_LINE, `Máximo ${MAX_UNITS_PER_LINE} unidades por presentación; para más, escríbenos por WhatsApp.`)
  })).min(1).max(60).refine(items => new Set(items.map(item => JSON.stringify([item.productId, item.variantSku]))).size === items.length, "Agrupa las cantidades de cada presentación en una sola línea"),
  shippingMethod: z.enum(["EXPRESS_QUITO_VALLES", "SERVIENTREGA_NATIONAL"]),
  paymentMethod: z.enum(["BANK_TRANSFER", "CASH_ON_DELIVERY"]).default("BANK_TRANSFER"),
  notes: z.string().trim().max(320).optional().default(""),
  paymentReference: z.string().trim().max(120).optional().default(""),
  // Código de descuento (C46); el servidor decide si aplica.
  discountCode: z.string().trim().toUpperCase().max(30).optional().default("")
});

export const orderStatusSchema = z.enum(["PENDING_PAYMENT", "PAYMENT_REVIEW", "PAID", "PREPARING", "SHIPPED", "COMPLETED", "CANCELLED", "RETURNED"]);
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const orderTransitions: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ["PAYMENT_REVIEW", "PAID", "CANCELLED"],
  PAYMENT_REVIEW: ["PENDING_PAYMENT", "PAID", "CANCELLED"],
  PAID: ["PREPARING", "CANCELLED"],
  PREPARING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  RETURNED: []
};
// Contra entrega se cobra al entregar: se prepara y despacha sin marcarlo pagado.
const cashOnDeliveryTransitions: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PENDING_PAYMENT: ["PREPARING", "PAID", "CANCELLED"]
};
// Contra entrega sin confirmar por WhatsApp (C36): solo puede cancelarse; al confirmarse sigue el flujo normal.
export const nextStatuses = (status: OrderStatus, paymentMethod: string | undefined, confirmedAt: unknown): OrderStatus[] => {
  if (paymentMethod === "CASH_ON_DELIVERY" && status === "PENDING_PAYMENT" && !confirmedAt) return ["CANCELLED"];
  return (paymentMethod === "CASH_ON_DELIVERY" ? cashOnDeliveryTransitions[status] : undefined) ?? orderTransitions[status];
};
/** Estados que implican dinero cobrado. En contra entrega, solo al registrar el pago o al completar la entrega. */
export const paidStatesFor = (paymentMethod?: string): OrderStatus[] =>
  paymentMethod === "CASH_ON_DELIVERY" ? ["PAID", "COMPLETED"] : ["PAID", "PREPARING", "SHIPPED", "COMPLETED"];
export const reservedOrderStates = ["PENDING_PAYMENT", "PAYMENT_REVIEW", "PAID", "PREPARING"];
