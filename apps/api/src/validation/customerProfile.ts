import { z } from "zod";
import { emailProblem, findCanton, findProvince, identificationProblem, inferIdType, mobileProblem, normalizeIdentification, normalizeMobile } from "../data/ecuador.js";

// CU03: perfil y libreta de direcciones del cliente. Mismos límites que el checkout (validation/order.ts):
// la tienda guía, el servidor decide. Plan de cuenta, §5.2.

/** Máximo inicial de direcciones por cuenta (propuesta del plan adoptada en CU01; configurable). */
export const MAX_CUSTOMER_ADDRESSES = 10;

// Texto libre: NFC, espacios extremos fuera y sin caracteres de control (los saltos de línea tampoco
// caben en un nombre o una dirección de una línea).
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const text = (min: number, max: number) => z.string().transform(value => value.normalize("NFC").trim().replace(/\s+/g, " "))
  .pipe(z.string().min(min, min > 1 ? `Escribe al menos ${min} caracteres.` : "Este dato es obligatorio.").max(max, `Máximo ${max} caracteres.`).refine(value => !CONTROL.test(value), "Quita los caracteres no permitidos."));
export const optionalText = (max: number) => z.string().optional().default("").transform(value => value.normalize("NFC").trim().replace(/\s+/g, " "))
  .pipe(z.string().max(max, `Máximo ${max} caracteres.`).refine(value => !CONTROL.test(value), "Quita los caracteres no permitidos."));
const mobile = z.string().trim().max(30).refine(value => !mobileProblem(value), "Escribe un celular de 10 dígitos que empiece con 09.").transform(normalizeMobile);
export const optionalMobile = z.string().trim().max(30).optional().default("").refine(value => !value || !mobileProblem(value), "Escribe un celular de 10 dígitos que empiece con 09.").transform(value => value ? normalizeMobile(value) : "");

export const customerNameSchema = text(3, 100);

export const contactInputSchema = z.object({
  name: customerNameSchema,
  phone: optionalMobile,
  altPhone: optionalMobile
}).strict().superRefine((value, context) => {
  if (value.altPhone && !value.phone) context.addIssue({ code: z.ZodIssueCode.custom, path: ["phone"], message: "Escribe primero tu celular principal." });
  if (value.altPhone && value.altPhone === value.phone) context.addIssue({ code: z.ZodIssueCode.custom, path: ["altPhone"], message: "El celular alternativo debe ser distinto del principal." });
});

export const billingInputSchema = z.object({
  name: text(3, 100),
  idType: z.enum(["CEDULA", "RUC", "PASAPORTE"]).optional(),
  idNumber: z.string().trim().max(30),
  email: z.string().trim().max(120).optional().default("").refine(value => !value || !emailProblem(value), "Escribe un correo válido, por ejemplo nombre@gmail.com.").transform(value => value.toLowerCase())
}).strict().superRefine((value, context) => {
  const type = value.idType ?? inferIdType(value.idNumber);
  if (!type) { context.addIssue({ code: z.ZodIssueCode.custom, path: ["idType"], message: "Elige el tipo de identificación: cédula, RUC o pasaporte." }); return; }
  const issue = identificationProblem(type, value.idNumber);
  if (issue) context.addIssue({ code: z.ZodIssueCode.custom, path: ["idNumber"], message: issue });
}).transform(value => {
  const idType = value.idType ?? inferIdType(value.idNumber)!;
  // Texto: los ceros iniciales de la cédula se conservan.
  return { ...value, idType, idNumber: normalizeIdentification(idType, value.idNumber) };
});

export const addressInputSchema = z.object({
  label: text(1, 40),
  province: z.string().trim().max(80).refine(value => !!findProvince(value), "Elige una provincia de la lista.").transform(value => findProvince(value)!.province),
  city: z.string().trim().max(80),
  address: text(8, 240),
  reference: optionalText(180),
  // Destinatario y contacto solo si difieren del titular; vacíos = el titular de la cuenta.
  recipientName: optionalText(100).refine(value => !value || value.length >= 3, "Escribe al menos 3 caracteres."),
  recipientPhone: optionalMobile
}).strict().superRefine((value, context) => {
  if (!findCanton(value.province, value.city)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["city"], message: "Elige una ciudad de la provincia seleccionada." });
  if (value.recipientName && !value.recipientPhone) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recipientPhone"], message: "Escribe el celular de quien recibe." });
}).transform(value => ({ ...value, city: findCanton(value.province, value.city)![0] }));

export type ContactInput = z.infer<typeof contactInputSchema>;
export type BillingInput = z.infer<typeof billingInputSchema>;
export type AddressInput = z.infer<typeof addressInputSchema>;

/**
 * Huella para avisar de una dirección repetida dentro de la misma cuenta: ubicación, dirección,
 * referencia y destinatario normalizados. No fusiona coincidencias parciales ni compara entre usuarios.
 */
export function addressFingerprint(address: AddressInput) {
  const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();
  return [address.province, address.city, address.address, address.reference, address.recipientName, address.recipientPhone].map(fold).join("|");
}
