import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { mailService, type MailOrder } from "./mail.service.js";

const order: MailOrder = {
  orderNumber: "RE-261002-AB12C",
  paymentMethod: "BANK_TRANSFER",
  customer: { fullName: "Ana Torres", email: "ana@correo.com", phone: "0991234567", province: "Pichincha", city: "Quito", address: "Av. Amazonas N24-100" },
  items: [{ title: "Creatine Monohydrate", variantLabel: "300 g", quantity: 1, unitPrice: 34.9, lineTotal: 34.9 }],
  shippingMethod: "EXPRESS_QUITO_VALLES",
  subtotal: 34.9,
  shippingFee: 0,
  total: 34.9,
  status: "PENDING_PAYMENT"
};

const original = { ADMIN_APP_URL: env.ADMIN_APP_URL, STORE_URL: env.STORE_URL };
afterEach(() => { Object.assign(env, original); vi.restoreAllMocks(); });

describe("aviso al operador", () => {
  it("«Abrir el panel» lleva al panel y no a la tienda", async () => {
    Object.assign(env, { ADMIN_APP_URL: "https://panel.rawenergy.test", STORE_URL: "https://tienda.rawenergy.test" });
    const send = vi.spyOn(mailService as unknown as { send: (to: string, subject: string, html: string) => Promise<boolean> }, "send").mockResolvedValue(true);
    await mailService.sendOperatorAlert(order);
    const html = send.mock.calls[0]?.[2] ?? "";
    expect(html).toContain('href="https://panel.rawenergy.test"');
    expect(html).not.toContain("https://tienda.rawenergy.test");
  });

  it("sin la dirección del panel, el aviso sale sin ese enlace", async () => {
    Object.assign(env, { ADMIN_APP_URL: undefined, STORE_URL: "https://tienda.rawenergy.test" });
    const send = vi.spyOn(mailService as unknown as { send: (to: string, subject: string, html: string) => Promise<boolean> }, "send").mockResolvedValue(true);
    await mailService.sendOperatorAlert(order);
    expect(send.mock.calls[0]?.[2] ?? "").not.toContain("Abrir el panel");
  });
});
