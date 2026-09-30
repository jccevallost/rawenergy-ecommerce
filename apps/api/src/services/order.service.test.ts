import { beforeAll, describe, expect, it, vi } from "vitest";
import { mailService } from "./mail.service.js";
import { telegramService } from "./telegram.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";

/** El listado puede venir de Mongo (_id) o de memoria (id), igual que en el resolver. */
const idOf = (order: { id?: unknown; _id?: unknown }) => String(order.id ?? order._id);

const customer = {
  fullName: "Ana Torres",
  email: "ana@correo.com",
  phone: "0991234567",
  province: "Pichincha",
  city: "Quito",
  address: "Av. Amazonas N34-100", idNumber: "1700000001",
  reference: "Edificio Vista"
};

const SKU = "DP-CREATINE-300G";
const SKU_WHEY = "GS-WHEY-CHOC-2LB";

const stockDisponible = async (sku = SKU) => {
  const producto = await productService.get(sku === SKU ? "demo-2" : "demo-1") as { variants: Array<{ sku: string; stock: number }> };
  return producto.variants.find((variant) => variant.sku === sku)!.stock;
};

const checkout = (overrides: Partial<{ fullName: string; email: string; phone: string }> = {}) => ({
  customer: { ...customer, ...overrides },
  items: [{ productId: "demo-2", variantSku: "DP-CREATINE-300G", quantity: 1 }],
  shippingMethod: "EXPRESS_QUITO_VALLES" as const,
  paymentMethod: "BANK_TRANSFER" as const,
  notes: "",
  paymentReference: ""
});

describe("OrderService en modo memoria", () => {
  beforeAll(async () => {
    await orderService.create(checkout());
    await orderService.create(checkout({ fullName: "Bruno Paez", email: "bruno@correo.com", phone: "0987654321" }));
    await orderService.create(checkout({ fullName: "Carla Nieto", email: "carla@correo.com", phone: "0970001122" }));
  });

  it("pagina el listado sin repetir ordenes", async () => {
    const first = await orderService.list({}, { limit: 2, offset: 0 });
    const second = await orderService.list({}, { limit: 2, offset: 2 });
    expect(first.totalCount).toBe(3);
    expect(first.orders).toHaveLength(2);
    expect(second.orders).toHaveLength(1);
    const ids = [...first.orders, ...second.orders].map(idOf);
    expect(new Set(ids).size).toBe(3);
  });

  it("busca por nombre, correo o telefono del cliente", async () => {
    const porNombre = await orderService.list({ search: "bruno" });
    expect(porNombre.totalCount).toBe(1);
    expect(porNombre.orders[0]!.customer.email).toBe("bruno@correo.com");

    const porTelefono = await orderService.list({ search: "0970001122" });
    expect(porTelefono.orders[0]!.customer.fullName).toBe("Carla Nieto");
  });

  it("filtra por estado y refleja el cambio en las metricas", async () => {
    const antes = await orderService.stats();
    expect(antes.total).toBe(3);
    expect(antes.pendingPayment).toBe(3);
    expect(antes.revenue).toBe(0);

    const objetivo = (await orderService.list({}, { limit: 1 })).orders[0]!;
    await orderService.updateStatus(idOf(objetivo), "PAID");

    const pagadas = await orderService.list({ status: "PAID" });
    expect(pagadas.totalCount).toBe(1);
    expect(idOf(pagadas.orders[0]!)).toBe(idOf(objetivo));

    const despues = await orderService.stats();
    expect(despues.pendingPayment).toBe(2);
    expect(despues.revenue).toBe(objetivo.total);
  });

  it("descuenta el inventario al crear la orden", async () => {
    // Las tres ordenes del beforeAll ya consumieron una unidad cada una.
    const antes = await stockDisponible();
    await orderService.create({ ...checkout(), items: [{ productId: "demo-2", variantSku: SKU, quantity: 4 }] });
    expect(await stockDisponible()).toBe(antes - 4);
  });

  it("devuelve el inventario al cancelar, y solo una vez", async () => {
    const creada = await orderService.create({ ...checkout(), items: [{ productId: "demo-2", variantSku: SKU, quantity: 5 }] });
    const id = idOf(creada);
    const conReserva = await stockDisponible();

    await orderService.updateStatus(id, "CANCELLED");
    const devuelto = await stockDisponible();
    expect(devuelto).toBe(conReserva + 5);

    // Cancelar una orden ya cancelada no puede regalar inventario.
    await orderService.updateStatus(id, "CANCELLED");
    expect(await stockDisponible()).toBe(devuelto);
  });

  it("conserva cancelaciones cerradas y exige crear un pedido nuevo", async () => {
    const creada = await orderService.create({ ...checkout(), items: [{ productId: "demo-2", variantSku: SKU, quantity: 3 }] });
    const id = idOf(creada);
    await orderService.updateStatus(id, "CANCELLED");
    const libre = await stockDisponible();
    await expect(orderService.updateStatus(id, "PAID")).rejects.toThrow(/no permitido/);
    expect(await stockDisponible()).toBe(libre);
  });

  it("rechaza la compra cuando no alcanza el inventario y no deja reservas sueltas", async () => {
    const disponible = await stockDisponible();
    const whey = await stockDisponible(SKU_WHEY);
    const pedido = {
      ...checkout(),
      items: [
        { productId: "demo-1", variantSku: SKU_WHEY, quantity: 1 },
        { productId: "demo-2", variantSku: SKU, quantity: disponible + 1 }
      ]
    };
    await expect(orderService.create(pedido)).rejects.toThrow(/Stock insuficiente/);
    // La primera linea alcanzo a reservarse: debe haberse devuelto.
    expect(await stockDisponible()).toBe(disponible);
    expect(await stockDisponible(SKU_WHEY)).toBe(whey);
  });

  it("avisa al cliente solo cuando el estado cambia de verdad", async () => {
    const aviso = vi.spyOn(mailService, "sendStatusUpdate").mockResolvedValue(true);
    const creada = await orderService.create({ ...checkout(), items: [{ productId: "demo-2", variantSku: SKU, quantity: 1 }] });
    const id = idOf(creada);
    aviso.mockClear();

    await orderService.updateStatus(id, "PAID");
    expect(aviso).toHaveBeenCalledTimes(1);

    // Reguardar el mismo estado no debe llenar de correos al cliente.
    await orderService.updateStatus(id, "PAID");
    expect(aviso).toHaveBeenCalledTimes(1);

    await orderService.updateStatus(id, "PREPARING");
    await orderService.updateStatus(id, "SHIPPED");
    expect(aviso).toHaveBeenCalledTimes(3);
    aviso.mockRestore();
  });

  it("avisa al cliente y al operador por los dos canales", async () => {
    const alCliente = vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
    const alOperador = vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);
    const porTelegram = vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);
    await orderService.create({ ...checkout(), items: [{ productId: "demo-2", variantSku: SKU, quantity: 1 }] });
    expect(alCliente).toHaveBeenCalledTimes(1);
    expect(alOperador).toHaveBeenCalledTimes(1);
    expect(porTelegram).toHaveBeenCalledTimes(1);
    alCliente.mockRestore();
    alOperador.mockRestore();
    porTelegram.mockRestore();
  });

  it("si Telegram falla, el pedido y el correo siguen su curso", async () => {
    const roto = vi.spyOn(telegramService, "sendOrderAlert").mockRejectedValue(new Error("Telegram caido"));
    const alCliente = vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
    const creada = await orderService.create({ ...checkout(), items: [{ productId: "demo-2", variantSku: SKU, quantity: 1 }] });
    expect(idOf(creada)).toBeTruthy();
    expect(alCliente).toHaveBeenCalledTimes(1);
    roto.mockRestore();
    alCliente.mockRestore();
  });

  it("un fallo de correo no impide crear el pedido", async () => {
    const roto = vi.spyOn(mailService, "sendOrderConfirmation").mockRejectedValue(new Error("SMTP caido"));
    const creada = await orderService.create({ ...checkout(), items: [{ productId: "demo-2", variantSku: SKU, quantity: 1 }] });
    expect(idOf(creada)).toBeTruthy();
    roto.mockRestore();
  });

  it("no deja comprar un producto archivado", async () => {
    await productService.archive("demo-2");
    await expect(orderService.create(checkout())).rejects.toThrow(/Producto no encontrado/);
    await productService.restore("demo-2");
  });
});
