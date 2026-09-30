import { randomUUID } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import depthLimit from "graphql-depth-limit";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { env } from "../config/env.js";
import { operationWidthRule } from "../graphql/validationRules.js";
import { authService, type AuthUser } from "./auth.service.js";
import { commerceSettingsService, defaultCommerceSettings, paymentRestriction, shippingFee } from "./commerceSettings.service.js";
import { mailService } from "./mail.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { reservationService } from "./reservation.service.js";
import { telegramService } from "./telegram.service.js";
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);
const notice = vi.spyOn(telegramService, "sendNotice").mockResolvedValue(true);

const server = new ApolloServer({ typeDefs, resolvers, validationRules: [depthLimit(4), operationWidthRule] });
let admin: AuthUser;
let catalog: AuthUser;
async function execute(query: string, variables: Record<string, unknown> = {}, user: AuthUser | null = admin) {
  const response = await server.executeOperation({ query, variables }, { contextValue: { user, requestId: randomUUID(), ip: `10.9.0.${Math.floor(Math.random() * 200)}` } });
  if (response.body.kind !== "single") throw new Error("single");
  return response.body.singleResult;
}
const customer = { fullName: "Persona de prueba", email: "test@example.test", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: "1700000001" };
const cityOf: Record<string, string> = { Pichincha: "Quito", Guayas: "Guayaquil" };
async function product(price: number, stock = 10) {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `pago-${randomUUID()}`;
  payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), stock, price }];
  const { id } = await productService.upsert(undefined, payload) as { id: string };
  return { productId: id, variantSku: payload.variants[0]!.sku };
}
const order = (item: { productId: string; variantSku: string }, paymentMethod: string, shippingMethod = "EXPRESS_QUITO_VALLES", province = "Pichincha") =>
  orderService.create({ idempotencyKey: randomUUID(), customer: { ...customer, province, city: cityOf[province] ?? "Quito" }, items: [{ ...item, quantity: 1 }], shippingMethod, paymentMethod }) as Promise<{ id: string; paymentMethod: string; shippingFee: number }>;

beforeAll(async () => {
  authService.setPersistence(false); await authService.bootstrapAdmin();
  admin = (await authService.users("ADMIN"))[0]!;
  catalog = await authService.saveAccount(admin, undefined, { name: "Catálogo", email: `catalogo-${randomUUID().slice(0, 6)}@example.com`, password: "Test-role-123", role: "CATALOG", status: "ACTIVE" });
});

describe("Configuración de pagos y envíos", () => {
  it("parte de los valores del propietario: Banco Pichincha, nacional $5, express gratis desde $75 y contra entrega sin mínimo", () => {
    const settings = defaultCommerceSettings();
    expect(settings.bank).toMatchObject({ name: "Banco Pichincha", accountType: "Ahorros", accountNumber: "4755789300", holder: "Juan Cevallos" });
    // El umbral inicial sale de FREE_SHIPPING_THRESHOLD (75 por omisión); la regla se prueba en su borde.
    expect(settings).toMatchObject({ freeShippingThreshold: env.FREE_SHIPPING_THRESHOLD, freeShippingMethods: ["EXPRESS_QUITO_VALLES"], showBankDetails: false });
    expect(shippingFee(settings, "EXPRESS_QUITO_VALLES", settings.freeShippingThreshold - 0.01)).toBe(4);
    expect(shippingFee(settings, "EXPRESS_QUITO_VALLES", settings.freeShippingThreshold)).toBe(0);
    expect(shippingFee(settings, "SERVIENTREGA_NATIONAL", 500)).toBe(5);
    expect(paymentRestriction(settings, "CASH_ON_DELIVERY", "EXPRESS_QUITO_VALLES", 5)).toBeNull();
    expect(paymentRestriction(settings, "CASH_ON_DELIVERY", "SERVIENTREGA_NATIONAL", 200)).toMatch(/express/);
    expect(paymentRestriction({ ...settings, cashOnDelivery: { ...settings.cashOnDelivery, minimumSubtotal: 50 } }, "CASH_ON_DELIVERY", "EXPRESS_QUITO_VALLES", 50)).toMatch(/más de \$50/);
    expect(paymentRestriction(settings, "BANK_TRANSFER", "SERVIENTREGA_NATIONAL", 1)).toBeNull();
  });

  it("el servidor rechaza contra entrega fuera de la regla aunque se llame a la API directamente", async () => {
    const cheap = await product(40), expensive = await product(80);
    await expect(order(expensive, "CASH_ON_DELIVERY", "SERVIENTREGA_NATIONAL", "Guayas")).rejects.toThrow(/express/);
    const accepted = await order(cheap, "CASH_ON_DELIVERY");
    expect(accepted).toMatchObject({ paymentMethod: "CASH_ON_DELIVERY", shippingFee: 4 });
    expect((await order(expensive, "BANK_TRANSFER")).shippingFee).toBe(0);
    expect((await order(expensive, "BANK_TRANSFER", "SERVIENTREGA_NATIONAL", "Guayas")).shippingFee).toBe(5);
  });

  it("contra entrega sin confirmar por WhatsApp se cancela a las 4 h y devuelve el stock; confirmado no vence (C36)", async () => {
    const item = await product(90, 5);
    const stock = async () => (await productService.get(item.productId) as { variants: Array<{ stock: number }> }).variants[0]!.stock;
    const unconfirmed = await order(item, "CASH_ON_DELIVERY");
    const confirmed = await order(item, "CASH_ON_DELIVERY");
    const transfer = await order(item, "BANK_TRANSFER");
    await orderService.confirmCashOnDelivery(confirmed.id, { location: "https://maps.google.com/?q=-0.18,-78.48" });
    expect(await stock()).toBe(2);
    const status = async (id: string) => (await orderService.get(id) as { status: string }).status;
    await reservationService.expire(new Date(Date.now() + 3.9 * 3600000), 24);
    expect(await status(unconfirmed.id)).toBe("PENDING_PAYMENT");
    await reservationService.expire(new Date(Date.now() + 4.1 * 3600000), 24);
    expect(await status(unconfirmed.id)).toBe("CANCELLED");
    expect(await stock()).toBe(3);
    expect(await status(transfer.id)).toBe("PENDING_PAYMENT");
    await reservationService.expire(new Date(Date.now() + 30 * 3600000), 24);
    expect([await status(confirmed.id), await status(transfer.id)]).toEqual(["PENDING_PAYMENT", "CANCELLED"]);
    const history = (await orderService.get(unconfirmed.id) as { history: Array<{ reason: string }> }).history;
    expect(history.at(-1)?.reason).toMatch(/sin confirmar por WhatsApp en 4 horas/);
    await expect(orderService.confirmCashOnDelivery(unconfirmed.id, {})).rejects.toThrow(/ya no está pendiente/);
    expect(await orderService.confirmCashOnDelivery(confirmed.id, {})).toMatchObject({ deliveryLocation: "https://maps.google.com/?q=-0.18,-78.48" });
    await expect(orderService.confirmCashOnDelivery(transfer.id, {})).rejects.toThrow(/Solo los pedidos contra entrega/);
  });

  it("contra entrega se prepara solo tras confirmar por WhatsApp; se despacha sin marcarse pagado y el pago se registra al completar", async () => {
    const item = await product(95, 4);
    const cod = await order(item, "CASH_ON_DELIVERY");
    const transfer = await order(item, "BANK_TRANSFER");
    await expect(orderService.updateStatus(transfer.id, "PREPARING")).rejects.toThrow(/no permitido/);
    await expect(orderService.updateStatus(cod.id, "PREPARING")).rejects.toThrow(/no permitido/);
    await orderService.confirmCashOnDelivery(cod.id, {});
    for (const status of ["PREPARING", "SHIPPED"] as const) {
      await orderService.updateStatus(cod.id, status);
      expect((await orderService.get(cod.id) as { paidAt?: Date | null }).paidAt ?? null).toBeNull();
    }
    await orderService.updateStatus(cod.id, "COMPLETED");
    expect((await orderService.get(cod.id) as { paidAt?: Date | null }).paidAt).toBeTruthy();
  });

  it("confirmación por WhatsApp desde el panel: permisos, estados permitidos y plazo visible al cliente", async () => {
    const created = await order(await product(30, 3), "CASH_ON_DELIVERY") as unknown as { id: string; orderNumber: string };
    const ORDER = "query($id:ID!){order(id:$id){allowedNextStatuses confirmedAt}}";
    const CONFIRM = "mutation($id:ID!,$location:String){confirmCashOnDeliveryOrder(id:$id,location:$location){confirmedAt deliveryLocation allowedNextStatuses}}";
    const TRACK = "query($n:String!,$c:String!){trackOrder(orderNumber:$n,contact:$c){awaitingConfirmation reservedUntil}}";
    expect((await execute(ORDER, { id: created.id })).data).toMatchObject({ order: { allowedNextStatuses: ["CANCELLED"], confirmedAt: null } });
    const tracked = (await execute(TRACK, { n: created.orderNumber, c: customer.email }, null)).data as { trackOrder: { awaitingConfirmation: boolean; reservedUntil: string } };
    expect(tracked.trackOrder.awaitingConfirmation).toBe(true);
    expect(Date.parse(tracked.trackOrder.reservedUntil) - Date.now()).toBeGreaterThan(3.9 * 3600000);
    expect((await execute(CONFIRM, { id: created.id }, null)).errors?.[0]).toBeDefined();
    const confirmed = (await execute(CONFIRM, { id: created.id, location: "Casa esquinera, portón negro" })).data as { confirmCashOnDeliveryOrder: { confirmedAt: string; deliveryLocation: string; allowedNextStatuses: string[] } };
    expect(confirmed.confirmCashOnDeliveryOrder).toMatchObject({ deliveryLocation: "Casa esquinera, portón negro", allowedNextStatuses: ["PREPARING", "PAID", "CANCELLED"] });
    expect(confirmed.confirmCashOnDeliveryOrder.confirmedAt).toBeTruthy();
    expect((await execute(TRACK, { n: created.orderNumber, c: customer.email }, null)).data).toMatchObject({ trackOrder: { awaitingConfirmation: false, reservedUntil: null } });
  });

  it("solo Administración la edita; revisión vieja rechazada; cambio de cuenta avisado y visible en la tienda", async () => {
    const SAVE = "mutation($input:JSON!,$revision:Int!){saveCommerceSettings(input:$input,revision:$revision)}";
    const current = await commerceSettingsService.get();
    const { revision: _r, updatedByName: _u, updatedAt: _a, ...input } = current;
    expect((await execute("{ checkoutInfo { bank { accountNumber } } }", {}, null)).data).toMatchObject({ checkoutInfo: { bank: null } });
    const next = { ...input, showBankDetails: true, bank: { ...input.bank, accountNumber: "2200112233" }, shippingFees: { ...input.shippingFees, SERVIENTREGA_NATIONAL: 6 }, cashOnDelivery: { ...input.cashOnDelivery, minimumSubtotal: 60 } };
    expect((await execute(SAVE, { input: next, revision: current.revision }, null)).errors?.[0]).toBeDefined();
    expect((await execute(SAVE, { input: next, revision: current.revision }, catalog)).errors?.[0]).toBeDefined();
    expect((await execute(SAVE, { input: { ...next, bank: { ...next.bank, accountNumber: "abc" } }, revision: current.revision })).errors?.[0]).toBeDefined();
    const before = notice.mock.calls.length;
    const saved = await execute(SAVE, { input: next, revision: current.revision });
    expect(saved.errors).toBeUndefined();
    expect(notice.mock.calls.length - before).toBe(1);
    expect(String(notice.mock.calls.at(-1)?.[0])).toContain("2200112233");
    expect((await execute(SAVE, { input: next, revision: current.revision })).errors?.[0]?.message).toMatch(/Otra persona/);
    const info = await execute("{ checkoutInfo { bank { accountNumber } shippingRates { method fee } cashOnDelivery { minimumSubtotal } } }", {}, null);
    expect(info.data).toMatchObject({ checkoutInfo: { bank: { accountNumber: "2200112233" }, cashOnDelivery: { minimumSubtotal: 60 } } });
    expect((info.data as { checkoutInfo: { shippingRates: Array<{ method: string; fee: number }> } }).checkoutInfo.shippingRates).toContainEqual({ method: "SERVIENTREGA_NATIONAL", fee: 6 });
    const cart = await productService.calculateCart([{ ...(await product(10)), quantity: 1 }], "SERVIENTREGA_NATIONAL");
    expect(cart.shippingFee).toBe(6);
    const same = await commerceSettingsService.get();
    await commerceSettingsService.save({ ...next, shippingFees: { ...next.shippingFees, EXPRESS_QUITO_VALLES: 4.5 } }, same.revision, { name: "Admin" });
    expect(notice.mock.calls.length - before).toBe(1);
  });
});
