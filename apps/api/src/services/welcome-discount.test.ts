import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { demoProducts } from "../data/demoProducts.js";
import { commerceSettingsService, defaultCommerceSettings } from "./commerceSettings.service.js";
import { mailService } from "./mail.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { telegramService } from "./telegram.service.js";
import { evaluateCode, prorate } from "./welcomeDiscount.service.js";
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);

// Cédulas válidas (dígito verificador módulo 10) distintas por prueba.
let serial = 100000;
const cedula = () => { const base = `17${String(++serial).padStart(7, "0")}`; const sum = base.split("").map(Number).reduce((s, v, i) => { let x = i % 2 === 0 ? v * 2 : v; if (x > 9) x -= 9; return s + x; }, 0); return base + ((10 - (sum % 10)) % 10); };
const person = () => { const n = ++serial; return { fullName: "Persona nueva", email: `nueva${n}@example.test`, phone: `09${String(n).padStart(8, "0")}`, province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: cedula() }; };
let a: { productId: string; variantSku: string }, b: { productId: string; variantSku: string };
beforeAll(async () => {
  for (const [price, set] of [[40, (x: typeof a) => { a = x; }], [25, (x: typeof a) => { b = x; }]] as const) {
    const payload = structuredClone(demoProducts[1]!); payload.slug = `bienvenida-${randomUUID()}`;
    payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), stock: 500, price }];
    const { id } = await productService.upsert(undefined, payload) as { id: string };
    set({ productId: id, variantSku: payload.variants[0]!.sku });
  }
});
type Created = { orderNumber: string; id?: string; _id?: unknown; subtotal: number; total: number; shippingFee: number; discount: { code: string; percent: number; amount: number } | null; items: Array<{ lineTotal: number; discount?: number }> };
const order = (customer: ReturnType<typeof person>, extra: Record<string, unknown> = {}) => orderService.create({ idempotencyKey: randomUUID(), customer, items: [{ ...a, quantity: 1 }, { ...b, quantity: 2 }], shippingMethod: "SERVIENTREGA_NATIONAL", paymentMethod: "BANK_TRANSFER", ...extra }) as Promise<Created>;
const code = () => defaultCommerceSettings().welcomeDiscount.code;

describe("Descuento de bienvenida con código (C46)", () => {
  it("valida el código sin mirar quién compra: vigencia, mínimo, mayúsculas y redondeo al centavo", () => {
    const rules = defaultCommerceSettings();
    expect(evaluateCode(rules, ` ${code().toLowerCase()} `, 59.9).discount).toEqual({ code: code(), percent: 10, amount: 5.99 });
    expect(evaluateCode(rules, "OTRO-CODIGO", 100).discount).toBeNull();
    expect(evaluateCode({ ...rules, welcomeDiscount: { ...rules.welcomeDiscount, enabled: false } }, code(), 100).discount).toBeNull();
    expect(evaluateCode({ ...rules, welcomeDiscount: { ...rules.welcomeDiscount, endsOn: "2020-01-01" } }, code(), 100).message).toMatch(/no está vigente/);
    expect(evaluateCode({ ...rules, welcomeDiscount: { ...rules.welcomeDiscount, minimumSubtotal: 50 } }, code(), 49.99).message).toMatch(/desde \$50\.00/);
    expect(evaluateCode(rules, "", 100)).toEqual({ discount: null, message: null });
  });

  it("reparte el descuento entre líneas sin perder ni sobrar un centavo", () => {
    for (const [lines, amount] of [[[40, 50], 9], [[10.01, 10.01, 10.01], 3], [[99.99], 10], [[0.5, 0.5], 0.1]] as Array<[number[], number]>) {
      const shares = prorate(lines, amount);
      expect(Math.round(shares.reduce((s, v) => s + v, 0) * 100)).toBe(Math.round(amount * 100));
      shares.forEach((share, i) => expect(share).toBeLessThanOrEqual(lines[i]!));
    }
  });

  it("el carrito muestra el 10 % y calcula el envío con lo que se paga por los productos", async () => {
    const rules = { ...defaultCommerceSettings(), freeShippingThreshold: 85, freeShippingMethods: ["SERVIENTREGA_NATIONAL" as const] };
    const items = [{ ...a, quantity: 1 }, { ...b, quantity: 2 }];
    const plain = await productService.calculateCart(items, "SERVIENTREGA_NATIONAL", rules);
    expect(plain).toMatchObject({ subtotal: 90, discount: 0, shippingFee: 0, total: 90 });
    const withCode = await productService.calculateCart(items, "SERVIENTREGA_NATIONAL", rules, code());
    expect(withCode).toMatchObject({ subtotal: 90, discount: 9, discountCode: code(), discountPercent: 10, shippingFee: 5, total: 86, amountUntilFreeShipping: 4 });
    expect(withCode.discountMessage).toMatch(/primera compra/);
  });

  it("primera compra: guarda el descuento, lo reparte por línea y lo resta del total", async () => {
    const created = await order(person(), { discountCode: code(), expectedTotal: 86 });
    expect(created.subtotal).toBe(90);
    expect(created.discount).toEqual({ code: code(), percent: 10, amount: 9 });
    expect(created.items.reduce((s, item) => s + (item.discount ?? 0), 0)).toBeCloseTo(9, 2);
    expect(created.total).toBe(86);
  });

  it("la misma persona no lo usa dos veces: ni con el mismo documento, ni celular, ni correo", async () => {
    const first = person();
    await order(first, { discountCode: code() });
    for (const change of [{ phone: person().phone, email: person().email }, { idNumber: cedula(), email: person().email }, { idNumber: cedula(), phone: person().phone }]) {
      await expect(order({ ...first, ...change }, { discountCode: code() })).rejects.toMatchObject({ extensions: { code: "DISCOUNT_NOT_ELIGIBLE" } });
    }
  });

  it("quien ya compró sin código tampoco es cliente nuevo; sin código sí puede volver a comprar", async () => {
    const buyer = person();
    await order(buyer);
    await expect(order(buyer, { discountCode: code() })).rejects.toMatchObject({ extensions: { code: "DISCOUNT_NOT_ELIGIBLE" } });
    await expect(order(buyer)).resolves.toMatchObject({ discount: null });
  });

  it("si el pedido con descuento se cancela, la persona puede volver a usarlo", async () => {
    const buyer = person();
    const created = await order(buyer, { discountCode: code() });
    await orderService.updateStatus(String(created.id ?? created._id), "CANCELLED", { reason: "Prueba de cancelación" });
    await expect(order(buyer, { discountCode: code() })).resolves.toMatchObject({ discount: { amount: 9 } });
  });

  it("un código inválido o un total esperado sin descuento no crean pedido", async () => {
    await expect(order(person(), { discountCode: "NO-EXISTE" })).rejects.toMatchObject({ extensions: { code: "DISCOUNT_NOT_ELIGIBLE" } });
    await expect(order(person(), { discountCode: code(), expectedTotal: 95 })).rejects.toMatchObject({ extensions: { code: "CART_TOTAL_CHANGED" } });
  });

  it("la configuración valida el código y el porcentaje", async () => {
    const current = await commerceSettingsService.get();
    const { revision: _r, updatedByName: _u, updatedAt: _a, ...input } = current;
    await expect(commerceSettingsService.save({ ...input, welcomeDiscount: { ...input.welcomeDiscount, code: "a b" } }, current.revision, { name: "Prueba" })).rejects.toThrow();
    await expect(commerceSettingsService.save({ ...input, welcomeDiscount: { ...input.welcomeDiscount, percent: 90 } }, current.revision, { name: "Prueba" })).rejects.toThrow();
  });
});
