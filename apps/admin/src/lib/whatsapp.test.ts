import { describe, expect, it } from "vitest";
import { customerMessage, customerWhatsappHref } from "./whatsapp";

const order = {
  orderNumber: "RE-261006-ABC123", total: 54.5, paymentMethod: "CASH_ON_DELIVERY" as const, status: "PENDING_PAYMENT" as const, confirmedAt: null,
  items: [{ productId: "p", variantSku: "s", title: "Creatine Monohydrate", variantLabel: "Sin sabor - 300 g", quantity: 2, unitPrice: 25, lineTotal: 50 }],
  customer: { fullName: "  María José Pérez ", address: "Av. Amazonas N34-100", city: "Quito" }
};

describe("WhatsApp al cliente desde el panel (C74)", () => {
  it("convierte el celular guardado al formato internacional y descarta lo que no es celular", () => {
    expect(customerWhatsappHref("0991234567", "Hola")).toBe("https://wa.me/593991234567?text=Hola");
    expect(customerWhatsappHref("+593 99 123 4567", "Hola")).toBe("https://wa.me/593991234567?text=Hola");
    expect(customerWhatsappHref("022345678", "Hola")).toBeNull();
    expect(customerWhatsappHref("", "Hola")).toBeNull();
  });

  it("contra entrega sin confirmar: pide confirmar y la ubicación, con productos y plazo", () => {
    const text = customerMessage(order as never, "06/10/26, 15:30");
    expect(text).toMatch(/^Hola María, te escribimos de RawEnergy por tu pedido RE-261006-ABC123 de \$54[.,]50 con pago contra entrega:/);
    expect(text).toContain("• 2 × Creatine Monohydrate (Sin sabor - 300 g)");
    expect(text).toContain("Entrega: Av. Amazonas N34-100, Quito.");
    expect(text).toContain("¿Nos confirmas el pedido y nos envías tu ubicación por aquí? Si no lo confirmas antes del 06/10/26, 15:30, se cancela automáticamente.");
  });

  it("transferencia pendiente recuerda el comprobante; contra entrega ya confirmado y el resto solo saludan", () => {
    expect(customerMessage({ ...order, paymentMethod: "BANK_TRANSFER" } as never)).toMatch(/comprobante de transferencia/);
    expect(customerMessage({ ...order, confirmedAt: "2026-10-06T10:00:00Z" } as never)).toBe("Hola María, te escribimos de RawEnergy por tu pedido RE-261006-ABC123.");
    expect(customerMessage({ ...order, status: "SHIPPED" } as never)).toBe("Hola María, te escribimos de RawEnergy por tu pedido RE-261006-ABC123.");
  });
});
