import { randomUUID } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { demoProducts } from "../data/demoProducts.js";
import { resolvers } from "../graphql/resolvers.js";
import { typeDefs } from "../graphql/typeDefs.js";
import { authService, type AuthUser } from "./auth.service.js";
import { defaultCommerceSettings } from "./commerceSettings.service.js";
import { customerProfileService } from "./customerProfile.service.js";
import { mailService, type MailOrder } from "./mail.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";
import { telegramService } from "./telegram.service.js";

// CU07: comprador, destinatario y facturación separados, con compatibilidad (plan §6 y §12 «Checkout», «Dinero/negocio»).
vi.spyOn(mailService, "sendOrderConfirmation").mockResolvedValue(true);
vi.spyOn(telegramService, "sendOrderAlert").mockResolvedValue(true);
const operatorAlert = vi.spyOn(mailService, "sendOperatorAlert").mockResolvedValue(true);

const server = new ApolloServer({ typeDefs, resolvers });
let serial = 300000;
const cedula = () => { const base = `17${String(++serial).padStart(7, "0")}`; const sum = base.split("").map(Number).reduce((s, v, i) => { let x = i % 2 === 0 ? v * 2 : v; if (x > 9) x -= 9; return s + x; }, 0); return base + ((10 - (sum % 10)) % 10); };
const buyer = () => { const n = ++serial; return { fullName: "Compradora Uno", email: `compra${n}@example.test`, phone: `09${String(n).padStart(8, "0")}`, province: "Pichincha", city: "Quito", address: "Calle de prueba 123", idNumber: cedula() }; };
let item: { productId: string; variantSku: string };
const stock = async () => (await productService.get(item.productId) as { variants: Array<{ sku: string; stock: number }> }).variants.find(v => v.sku === item.variantSku)!.stock;
type Created = { id?: unknown; _id?: unknown; orderNumber: string; customer: { address: string; city: string }; delivery?: Record<string, unknown> | null; billing?: Record<string, unknown> | null; discount?: unknown };
const create = (input: Record<string, unknown>, user?: AuthUser | null) => orderService.create({ idempotencyKey: randomUUID(), items: [{ ...item, quantity: 1 }], shippingMethod: "SERVIENTREGA_NATIONAL", paymentMethod: "BANK_TRANSFER", ...input }, user) as Promise<Created>;
const idOf = (order: Created) => String(order.id ?? order._id);
const customer = async () => (await authService.createVerifiedCustomer({ name: "Ana Pérez", email: `entrega-${randomUUID()}@example.test`, password: "Entrega-segura-2026" })).user as AuthUser;
const home = { label: "Casa", province: "Pichincha", city: "Quito", address: "Av. Amazonas N24-100 y Colón", reference: "Edificio azul" };
async function query(text: string, variables: Record<string, unknown>, user: AuthUser | null = null) {
  const response = await server.executeOperation({ query: text, variables }, { contextValue: { user: user as never, requestId: randomUUID(), ip: "198.51.100.30" } });
  if (response.body.kind !== "single") throw new Error("single");
  return response.body.singleResult as { data?: Record<string, any>; errors?: Array<{ message: string; extensions?: { code?: string } }> };
}

beforeAll(async () => {
  const payload = structuredClone(demoProducts[1]!); payload.slug = `entrega-${randomUUID()}`;
  payload.variants = [{ ...payload.variants[0]!, sku: randomUUID(), stock: 500, price: 40 }];
  const { id } = await productService.upsert(undefined, payload) as { id: string };
  item = { productId: id, variantSku: payload.variants[0]!.sku };
});
afterEach(() => { operatorAlert.mockClear(); });

describe("compatibilidad", () => {
  it("una entrada antigua crea el pedido de siempre y GraphQL lo presenta como comprador = destinatario = factura", async () => {
    const person = buyer();
    const order = await create({ customer: person });
    expect(order.delivery ?? null).toBeNull();
    expect(order.billing ?? null).toBeNull();
    const user = { id: "staff", name: "Personal", email: "staff@example.test", role: "ADMIN", status: "ACTIVE", twoFactorEnabled: true } as AuthUser;
    const { data, errors } = await query("query($id:ID!){ order(id:$id){ recipient { name phone sameAsBuyer } invoice { name idNumber email sameAsBuyer } } }", { id: idOf(order) }, user);
    expect(errors).toBeUndefined();
    expect(data!.order.recipient).toEqual({ name: person.fullName, phone: person.phone, sameAsBuyer: true });
    expect(data!.order.invoice).toEqual({ name: person.fullName, idNumber: person.idNumber, email: person.email, sameAsBuyer: true });
  });
});

describe("destinatario y factura distintos", () => {
  it("entrega a otra persona sin cambiar comprador ni factura, y el operador lo ve", async () => {
    const person = buyer();
    const order = await create({ customer: person, delivery: { recipientName: "Luis Pérez", recipientPhone: "+593 98 765 4321" } });
    expect(order.delivery).toMatchObject({ recipientName: "Luis Pérez", recipientPhone: "0987654321", addressId: null });
    expect((operatorAlert.mock.calls.at(-1)?.[0] as MailOrder).delivery?.recipientName).toBe("Luis Pérez");
  });

  it("nombre sin celular de quien recibe, o al revés, se rechaza", async () => {
    await expect(create({ customer: buyer(), delivery: { recipientName: "Luis Pérez" } })).rejects.toThrow();
    await expect(create({ customer: buyer(), delivery: { recipientPhone: "0987654321" } })).rejects.toThrow();
  });

  it("factura a nombre distinto: se valida y se guarda aparte del comprador", async () => {
    await expect(create({ customer: buyer(), billing: { name: "Empresa S.A.", idNumber: "1790000000000" } })).rejects.toThrow();
    const order = await create({ customer: buyer(), billing: { name: "Empresa Ejemplo", idNumber: "0926687856", email: "Factura@Empresa.test" } });
    expect(order.billing).toMatchObject({ name: "Empresa Ejemplo", idType: "CEDULA", idNumber: "0926687856", email: "factura@empresa.test" });
  });
});

describe("dirección guardada", () => {
  it("el contenido guardado manda sobre el texto enviado y se copia en el pedido", async () => {
    const user = await customer();
    const { addressId, profile } = await customerProfileService.addAddress(user, { ...home, recipientName: "Luis Pérez", recipientPhone: "0987654321" }, 0);
    const saved = profile.addresses.find(a => a.id === addressId)!;
    const order = await create({ customer: { ...buyer(), province: "Guayas", city: "Guayaquil", address: "Otra calle manipulada 999" }, shippingMethod: "EXPRESS_QUITO_VALLES", delivery: { addressId, addressUpdatedAt: saved.updatedAt } }, user);
    expect(order.customer).toMatchObject({ city: "Quito", address: home.address });
    expect(order.delivery).toMatchObject({ addressId, addressLabel: "Casa", recipientName: "Luis Pérez", recipientPhone: "0987654321" });
    // Borrar la dirección después no cambia el pedido.
    await customerProfileService.removeAddress(user, addressId, profile.revision);
    expect((await orderService.findByNumber(order.orderNumber) as Created).customer.address).toBe(home.address);
  });

  it("una dirección ajena responde igual que una inexistente; un invitado no puede usarlas", async () => {
    const owner = await customer(), other = await customer();
    const { addressId, profile } = await customerProfileService.addAddress(owner, home, 0);
    const updatedAt = profile.addresses[0]!.updatedAt;
    const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error("Debía rechazarse"); }, (error: Error) => error);
    const foreign = await failure(create({ customer: buyer(), delivery: { addressId, addressUpdatedAt: updatedAt } }, other));
    const missing = await failure(create({ customer: buyer(), delivery: { addressId: randomUUID(), addressUpdatedAt: updatedAt } }, other));
    expect(foreign.message).toBe("Esa dirección ya no está en tu cuenta. Elige otra o escríbela.");
    expect(missing.message).toBe(foreign.message);
    await expect(create({ customer: buyer(), delivery: { addressId, addressUpdatedAt: updatedAt } }, null)).rejects.toThrow(/Entra a tu cuenta/);
  });

  it("si la dirección cambió mientras compraba, no se crea el pedido ni se reserva stock", async () => {
    const user = await customer();
    const first = await customerProfileService.addAddress(user, home, 0);
    const seen = first.profile.addresses[0]!.updatedAt;
    await new Promise(resolve => setTimeout(resolve, 5));
    await customerProfileService.updateAddress(user, first.addressId, { ...home, address: "Av. Amazonas N24-200 y Colón" }, first.profile.revision);
    const before = await stock();
    const error = await create({ customer: buyer(), delivery: { addressId: first.addressId, addressUpdatedAt: seen } }, user).then(() => ({} as { extensions?: { code?: string } }), (e: { extensions?: { code?: string } }) => e);
    expect(error.extensions?.code).toBe("CONFLICT");
    expect(await stock()).toBe(before);
  });

  it("un reintento con la misma clave devuelve el pedido creado aunque luego se edite la dirección", async () => {
    const user = await customer();
    const first = await customerProfileService.addAddress(user, home, 0);
    const input = { idempotencyKey: randomUUID(), customer: buyer(), items: [{ ...item, quantity: 1 }], shippingMethod: "SERVIENTREGA_NATIONAL", delivery: { addressId: first.addressId, addressUpdatedAt: first.profile.addresses[0]!.updatedAt } };
    const created = await orderService.create(structuredClone(input), user) as Created;
    await customerProfileService.updateAddress(user, first.addressId, { ...home, address: "Av. Amazonas N24-300 y Colón" }, first.profile.revision);
    const retry = await orderService.create(structuredClone(input), user) as Created;
    expect(idOf(retry)).toBe(idOf(created));
    expect(retry.customer.address).toBe(home.address);
  });
});

describe("reglas de negocio con destinatario distinto", () => {
  it("el descuento de bienvenida mira al comprador: cambiar quién recibe no lo vuelve a habilitar", async () => {
    const person = buyer();
    const code = defaultCommerceSettings().welcomeDiscount.code;
    expect((await create({ customer: person, discountCode: code, items: [{ ...item, quantity: 2 }] })).discount).toBeTruthy();
    await expect(create({ customer: person, discountCode: code, items: [{ ...item, quantity: 2 }], delivery: { recipientName: "Otra Persona", recipientPhone: "0981111111" } })).rejects.toThrow();
  });

  it("el límite de pedidos pendientes cuenta al comprador, no a quien recibe", async () => {
    const limit = env.MAX_PENDING_ORDERS_PER_CUSTOMER;
    env.MAX_PENDING_ORDERS_PER_CUSTOMER = 1;
    try {
      const busy = buyer();
      await create({ customer: busy });
      // Otra compradora puede enviar a la persona que ya tiene un pedido pendiente.
      await expect(create({ customer: buyer(), delivery: { recipientName: busy.fullName, recipientPhone: busy.phone } })).resolves.toBeTruthy();
      // La compradora con pendiente no evade el límite enviando a otra persona.
      await expect(create({ customer: busy, delivery: { recipientName: "Otra Persona", recipientPhone: "0982222222" } })).rejects.toThrow(/pendiente/);
    } finally { env.MAX_PENDING_ORDERS_PER_CUSTOMER = limit; }
  });
});
