import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { mailService } from "./mail.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { reservationService } from "./reservation.service.js";
import { telegramService } from "./telegram.service.js";
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(mailService, "sendStatusUpdate").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

const customer = { fullName: "Persona de prueba", email: "test@example.test", phone: "0999999999", province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: "1700000001" };
const HOUR = 3600000;

async function fixture(stock = 5) {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `reserva-${randomUUID()}`;
  payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), stock, price: 25 }];
  const { id } = await productService.upsert(undefined, payload) as { id: string };
  const sku = payload.variants[0]!.sku;
  const stockNow = async () => (await productService.get(id))!.variants[0]!.stock;
  const order = async (quantity = 2) => orderService.create({ idempotencyKey: randomUUID(), customer, items: [{ productId: id, variantSku: sku, quantity }], shippingMethod: "EXPRESS_QUITO_VALLES", paymentMethod: "BANK_TRANSFER" }) as Promise<{ id: string; status: string }>;
  return { stockNow, order };
}
const status = async (id: string) => (await orderService.get(id) as { status: string }).status;

describe("Reserva de stock de 24 horas", () => {
  it("cancela el pedido sin pago al vencer y repone el stock una sola vez", async () => {
    const f = await fixture(5);
    const created = await f.order(2);
    expect(await f.stockNow()).toBe(3);
    expect(await reservationService.expire(new Date(Date.now() + 23 * HOUR), 24)).toBe(0);
    expect(await status(created.id)).toBe("PENDING_PAYMENT");
    expect(await reservationService.expire(new Date(Date.now() + 25 * HOUR), 24)).toBeGreaterThanOrEqual(1);
    expect(await status(created.id)).toBe("CANCELLED");
    expect(await f.stockNow()).toBe(5);
    await reservationService.expire(new Date(Date.now() + 26 * HOUR), 24);
    expect(await f.stockNow()).toBe(5);
    const history = (await orderService.get(created.id) as { history: Array<{ reason: string }> }).history;
    expect(history.at(-1)?.reason).toBe("Vencido: sin pago en 24 horas");
  });

  it("no cancela pedidos con comprobante en revisión ni pagados", async () => {
    const f = await fixture(6);
    const review = await f.order(1);
    const paid = await f.order(1);
    await orderService.updateStatus(review.id, "PAYMENT_REVIEW");
    await orderService.updateStatus(paid.id, "PAID");
    await reservationService.expire(new Date(Date.now() + 48 * HOUR), 24);
    expect(await status(review.id)).toBe("PAYMENT_REVIEW");
    expect(await status(paid.id)).toBe("PAID");
    expect(await f.stockNow()).toBe(4);
  });

  it("si el pago llega en el mismo instante, gana uno solo y el stock no se repone dos veces", async () => {
    const f = await fixture(3);
    const created = await f.order(3);
    const results = await Promise.allSettled([
      reservationService.expire(new Date(Date.now() + 25 * HOUR), 24),
      orderService.updateStatus(created.id, "PAID")
    ]);
    const final = await status(created.id);
    expect(["CANCELLED", "PAID"]).toContain(final);
    expect(await f.stockNow()).toBe(final === "CANCELLED" ? 3 : 0);
    if (final === "CANCELLED") expect(results[1]!.status).toBe("rejected");
  });
});
