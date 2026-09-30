import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { unitOfWork } from "../lib/unitOfWork.js";
import { mailService } from "./mail.service.js";
import { orderService } from "./order.service.js";
import { LEASE_MS, MAX_ATTEMPTS, notificationOutbox } from "./outbox.service.js";
import { productService } from "./product.service.js";
import { telegramService } from "./telegram.service.js";

const confirmation = vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
const operatorMail = vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
const statusMail = vi.spyOn(mailService, "sendStatusUpdate").mockResolvedValue(true);
const orderAlert = vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);
const notice = vi.spyOn(telegramService, "sendNotice").mockResolvedValue(true);
const telegramEnabled = vi.spyOn(telegramService, "enabled", "get").mockReturnValue(true);

const customer = { fullName: "Persona de prueba", email: "avisos@example.test", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: "1700000001" };
async function order() {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `aviso-${randomUUID()}`;
  payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), stock: 5, price: 30 }];
  const { id } = await productService.upsert(undefined, payload) as { id: string };
  return orderService.create({ idempotencyKey: randomUUID(), customer, items: [{ productId: id, variantSku: payload.variants[0]!.sku, quantity: 1 }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" }) as Promise<{ id: string; orderNumber: string }>;
}
const later = (ms: number) => new Date(Date.now() + ms);
const notify = (text: string) => notificationOutbox.enqueue([{ kind: "OPERATOR_NOTICE", label: text, text }]);

beforeEach(async () => {
  await notificationOutbox.drain();
  await notificationOutbox.run(later(24 * 3600_000));
  vi.clearAllMocks();
  confirmation.mockResolvedValue(true); operatorMail.mockResolvedValue(true); statusMail.mockResolvedValue(true);
  orderAlert.mockResolvedValue(true); notice.mockResolvedValue(true); telegramEnabled.mockReturnValue(true);
});

describe("Bandeja de avisos (P05)", () => {
  it("un pedido guarda sus tres avisos y salen al confirmar; si la operación se revierte, no sale ninguno", async () => {
    const created = await order();
    await notificationOutbox.drain();
    expect(confirmation).toHaveBeenCalledTimes(1); expect(operatorMail).toHaveBeenCalledTimes(1); expect(orderAlert).toHaveBeenCalledTimes(1);
    expect(String(orderAlert.mock.calls[0]![0].orderNumber)).toBe(created.orderNumber);
    expect((await notificationOutbox.summary()).pending).toBe(0);

    await expect(unitOfWork(async () => { await notify("no debe salir"); throw new Error("fallo posterior"); })).rejects.toThrow("fallo posterior");
    await notificationOutbox.drain(); await notificationOutbox.run(later(LEASE_MS * 2));
    expect(notice).not.toHaveBeenCalled();
    expect((await notificationOutbox.summary()).pending).toBe(0);
  });

  it("si Telegram falla, espera y reintenta; se envía una sola vez", async () => {
    orderAlert.mockResolvedValueOnce(false);
    await order();
    await notificationOutbox.drain();
    expect(orderAlert).toHaveBeenCalledTimes(1);
    expect((await notificationOutbox.summary()).pending).toBe(1);
    await notificationOutbox.run(later(10_000));
    expect(orderAlert).toHaveBeenCalledTimes(1);
    await notificationOutbox.run(later(61_000));
    expect(orderAlert).toHaveBeenCalledTimes(2);
    await notificationOutbox.run(later(24 * 3600_000));
    expect(orderAlert).toHaveBeenCalledTimes(2);
    expect(confirmation).toHaveBeenCalledTimes(1);
    expect((await notificationOutbox.summary()).pending).toBe(0);
  });

  it("un aviso que quedó en curso por una caída se retoma al vencer la reserva y el proceso viejo no pisa el resultado", async () => {
    let finishStale!: (value: boolean) => void;
    notice.mockImplementationOnce(() => new Promise<boolean>(resolve => { finishStale = resolve; }));
    await notify("cuenta bancaria cambiada");
    expect(notice).toHaveBeenCalledTimes(1);
    await notificationOutbox.run(later(LEASE_MS - 10_000));
    expect(notice).toHaveBeenCalledTimes(1);
    await notificationOutbox.run(later(LEASE_MS + 1_000));
    expect(notice).toHaveBeenCalledTimes(2);
    finishStale(false);
    await notificationOutbox.drain();
    await notificationOutbox.run(later(24 * 3600_000));
    expect(notice).toHaveBeenCalledTimes(2);
    expect(await notificationOutbox.summary()).toMatchObject({ pending: 0, failed: 0 });
  });

  it(`tras ${MAX_ATTEMPTS} intentos queda fallido, visible en el panel, y se puede reintentar`, async () => {
    notice.mockResolvedValue(false);
    await notify("aviso que falla");
    await notificationOutbox.drain();
    await notificationOutbox.run(later(24 * 3600_000));
    expect(notice).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    const summary = await notificationOutbox.summary();
    expect(summary.failed).toBe(1);
    expect(summary.failures[0]).toMatchObject({ label: "aviso que falla", attempts: MAX_ATTEMPTS });
    notice.mockResolvedValue(true);
    expect(await notificationOutbox.retryFailed()).toBe(1);
    await notificationOutbox.run(later(1_000));
    expect(notice).toHaveBeenCalledTimes(MAX_ATTEMPTS + 1);
    expect(await notificationOutbox.summary()).toMatchObject({ pending: 0, failed: 0 });
  });

  it("canal sin configurar: se omite sin reintentos ni alertas de fallo", async () => {
    telegramEnabled.mockReturnValue(false); notice.mockResolvedValue(false);
    await notify("sin Telegram");
    await notificationOutbox.drain(); await notificationOutbox.run(later(24 * 3600_000));
    expect(notice).toHaveBeenCalledTimes(1);
    expect(await notificationOutbox.summary()).toMatchObject({ pending: 0, failed: 0 });
  });

  it("dos revisiones simultáneas de la bandeja no envían dos veces el mismo aviso", async () => {
    notice.mockResolvedValueOnce(false);
    await notify("reintento único");
    await notificationOutbox.drain();
    await Promise.all([notificationOutbox.run(later(61_000)), notificationOutbox.run(later(61_000)), notificationOutbox.run(later(61_000))]);
    expect(notice).toHaveBeenCalledTimes(2);
  });

  it("el cambio de estado avisa al cliente solo en estados con correo, con el estado de ese momento", async () => {
    const created = await order();
    await orderService.updateStatus(created.id, "PAYMENT_REVIEW");
    await orderService.updateStatus(created.id, "PAID");
    await notificationOutbox.drain();
    expect(statusMail.mock.calls.map(call => call[0].status)).toEqual(["PAYMENT_REVIEW", "PAID"]);
  });
});
