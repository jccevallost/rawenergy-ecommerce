import { afterEach, describe, expect, it, vi } from "vitest";
import { telegramService } from "./telegram.service.js";

const order = {
  orderNumber: "RE-260909-TEST1",
  customer: {
    fullName: "Maria <script>alert(1)</script>",
    email: "maria@correo.com",
    phone: "0993334444",
    province: "Pichincha",
    city: "Quito",
    address: "Av. Eloy Alfaro N32-500", idNumber: "1700000001",
    reference: ""
  },
  items: [{ title: "Gold Standard 100% Whey", variantLabel: "Chocolate - 2 lb", quantity: 2 }],
  shippingMethod: "EXPRESS_QUITO_VALLES" as const,
  total: 119.8,
  paymentReference: ""
};

afterEach(() => vi.restoreAllMocks());

describe("TelegramService", () => {
  it("no envia nada si falta configuracion", async () => {
    const red = vi.spyOn(globalThis, "fetch");
    expect(telegramService.enabled).toBe(false);
    expect(await telegramService.sendOrderAlert(order)).toBe(false);
    expect(red).not.toHaveBeenCalled();
  });

  it("escapa el texto del cliente para que no inyecte marcado", async () => {
    vi.spyOn(telegramService, "enabled", "get").mockReturnValue(true);
    const red = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await telegramService.sendOrderAlert(order);

    const [, init] = red.mock.calls[0]!;
    const enviado = JSON.parse(String(init!.body)) as { text: string };
    expect(enviado.text).toContain("&lt;script&gt;");
    expect(enviado.text).not.toContain("<script>");
    // Las etiquetas propias del mensaje si deben viajar como HTML.
    expect(enviado.text).toContain("<b>Pedido nuevo RE-260909-TEST1</b>");
  });

  it("un error de red no se propaga", async () => {
    vi.spyOn(telegramService, "enabled", "get").mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("sin red"));
    expect(await telegramService.sendOrderAlert(order)).toBe(false);
  });

  it("una respuesta de error de Telegram se reporta como fallo", async () => {
    vi.spyOn(telegramService, "enabled", "get").mockReturnValue(true);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    expect(await telegramService.sendOrderAlert(order)).toBe(false);
  });
});
