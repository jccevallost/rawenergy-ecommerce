import { unitOfWork, operationContext, registerMemoryStore } from "../lib/unitOfWork.js";
import { withLayer, type StockLot } from "./stockLedger.service.js";
import { supplyService } from "./supply.service.js";
import mongoose from "mongoose";
import { GraphQLError } from "graphql";
import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import { evaluateCode, notEligible, personKeys, prorate, redemptions, type AppliedDiscount } from "./welcomeDiscount.service.js";
import { env } from "../config/env.js";
import { commerceSettingsService, paymentRestriction, shippingFee as feeFor } from "./commerceSettings.service.js";
import { OrderModel } from "../models/Order.js";
import { checkoutInputSchema, nextStatuses, orderStatusSchema, paidStatesFor, reservedOrderStates, type CheckoutInput, type OrderStatus } from "../validation/order.js";
import { hasStatusMail, type MailOrder } from "./mail.service.js";
import { notificationOutbox } from "./outbox.service.js";
import { emailDomainService } from "./emailDomain.service.js";
import { isExpressArea } from "../data/ecuador.js";
import { productService } from "./product.service.js";
import type { AuthUser } from "./auth.service.js";
import { customerProfileService } from "./customerProfile.service.js";
import { customerCancellation, ORDER_GROUPS } from "./customerOrders.js";
import { blockedIdentities, blockedMessage } from "./blockedIdentities.js";
import { cancellationStore } from "./cancellationRequests.store.js";
import { authService } from "./auth.service.js";
import { usesMongo } from "../lib/persistence.js";
import { contentFingerprint } from "../lib/canonical.js";
import { assertUniqueIndex } from "../lib/indexes.js";

export type OrderReturn = { at: Date; reason: string; restocked: boolean; items: Array<{ productId: string; variantSku: string; title: string; quantity: number; allocations: StockLot[]; value: number }> };
type OrderItem = {
  productId: string;
  variantSku: string;
  title: string;
  variantLabel: string;
  image: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  allocations?: StockLot[];
  unitCost?: number | null;
  categories?: Array<{ name: string; slug: string }>;
  discount?: number;
};

/** CU07: destinatario distinto del comprador y dirección guardada de origen. */
export type OrderDelivery = { recipientName: string; recipientPhone: string; addressId: string | null; addressLabel: string };

type MemoryOrder = {
  id: string;
  orderNumber: string;
  userId?: string | null;
  customer: CheckoutInput["customer"];
  delivery?: OrderDelivery | null;
  billing?: CheckoutInput["billing"] | null;
  items: OrderItem[];
  shippingMethod: CheckoutInput["shippingMethod"];
  paymentMethod: CheckoutInput["paymentMethod"];
  status: OrderStatus;
  subtotal: number;
  discount?: AppliedDiscount | null;
  shippingFee: number;
  total: number;
  notes: string;
  paymentReference: string;
  stockReserved: boolean;
  createdAt: Date;
  updatedAt: Date;
  paidAt?: Date | null;
  confirmedAt?: Date | null;
  deliveryLocation?: string;
  requestKey?: string;
  requestFingerprint?: string;
  history?: Array<{ from: string; to: string; at: Date; actorId: string; reason: string }>;
  returnInfo?: { at: Date; reason: string; restocked: boolean } | null;
  returns?: OrderReturn[];
  refund?: { at: Date; reason: string; reference: string; amount: number } | null;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
/**
 * «Sabor - tamaño» de la línea del pedido (mensaje de WhatsApp, correos, Mis pedidos), igual que
 * la tienda (C63): coma decimal («5,5 lb») y sin repetir el formato («Cápsulas» en «60 cápsulas»).
 */
export function presentationLabel(flavor: string, size: { value: number; unit: string }) {
  const sizeText = `${String(size.value).replace(".", ",")} ${size.unit}`.trim();
  return !flavor?.trim() || plain(sizeText).includes(plain(flavor)) ? sizeText : `${flavor} - ${sizeText}`;
}

// Date.now() repite valor si llegan dos ordenes en el mismo milisegundo, y dos
// ordenes con el mismo id harian que cambiar el estado de una mueva a la otra.
let memorySequence = 0;
const memoryId = () => `memory-${Date.now()}-${++memorySequence}`;

// El número acompaña al correo o celular en la consulta de pedido: se genera con el
// generador criptográfico (C60, S17). 6 caracteres de 36 posibles por día; el índice
// único del modelo impide repetidos.
const ORDER_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const orderNumber = () => `RE-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${Array.from({ length: 6 }, () => ORDER_ALPHABET[randomInt(ORDER_ALPHABET.length)]).join("")}`;

class OrderService {
  private memory: MemoryOrder[] = [];
  constructor() { registerMemoryStore(() => this.memory, (value) => { this.memory = value; }); }
  private get useMongo() {
    return usesMongo();
  }

  async create(rawInput: unknown, user?: AuthUser | null, options: { beforeNew?: () => Promise<void> } = {}): Promise<MemoryOrder | import("mongoose").HydratedDocument<import("../models/Order.js").OrderDocument>> {
    if (!operationContext.getStore()) return unitOfWork(() => this.create(rawInput, user, options));
    const input = checkoutInputSchema.parse(rawInput);
    const { idempotencyKey, ...request } = input;
    const requestKey = idempotencyKey ? createHash("sha256").update(`${user?.id ?? "guest"}:${idempotencyKey}`).digest("hex") : undefined;
    // Huella canónica (M35): no depende del orden de las propiedades. Se acepta la huella anterior
    // para que un reintento de un pedido creado antes de este cambio siga reconociéndose.
    const requestFingerprint = contentFingerprint(request), legacyFingerprint = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    if (requestKey) {
      assertUniqueIndex("Order", "requestKey");
      const previous = this.useMongo ? await OrderModel.findOne({ requestKey }) : this.memory.find(o => o.requestKey === requestKey);
      if (previous) {
        if (previous.requestFingerprint !== requestFingerprint && previous.requestFingerprint !== legacyFingerprint) throw new Error("Este intento de compra ya se usó con otros datos. Revisa el pedido anterior antes de crear otro.");
        return previous;
      }
    }
    // Pedido nuevo (no es un reintento): comprobación de persona si está activa (C70).
    await options.beforeNew?.();
    // CU11: identidad de una cuenta bloqueada por cancelaciones seguidas: tampoco compra como invitado.
    if (await blockedIdentities.any(personKeys(input.customer))) throw new GraphQLError(blockedMessage, { extensions: { code: "ACCOUNT_BLOCKED" } });
    // CU07: después de la huella. Un reintento con la misma clave ya devolvió su pedido aunque la libreta cambiara.
    const delivery = await this.resolveDelivery(input, user);
    if (input.shippingMethod === "EXPRESS_QUITO_VALLES" && !isExpressArea(input.customer.province, input.customer.city)) {
      throw new Error("El envío express cubre Quito (con Cumbayá, Tumbaco y Conocoto) y Rumiñahui (Sangolquí). Para otra ciudad elige envío nacional.");
    }
    // Acaparamiento (C60, S04): cada pedido reserva stock hasta el pago o la confirmación;
    // una misma persona no puede tener más de MAX_PENDING_ORDERS_PER_CUSTOMER a la vez.
    if (await this.pendingOrders(input.customer) >= env.MAX_PENDING_ORDERS_PER_CUSTOMER) {
      throw new GraphQLError(`Ya tienes ${env.MAX_PENDING_ORDERS_PER_CUSTOMER === 1 ? "un pedido pendiente" : `${env.MAX_PENDING_ORDERS_PER_CUSTOMER} pedidos pendientes`} de pago o de confirmación. Complétalos o escríbenos por WhatsApp antes de hacer otro.`, { extensions: { code: "TOO_MANY_PENDING_ORDERS" } });
    }
    const emailIssue = await emailDomainService.problem(input.customer.email);
    if (emailIssue) throw new GraphQLError(emailIssue, { extensions: { code: "BAD_USER_INPUT", field: "email" } });
    const items: OrderItem[] = [];

    for (const item of input.items) {
      const product = await productService.getSellable(item.productId) as {
        id?: string;
        _id?: unknown;
        title: string;
        categories: Array<{ name: string; slug: string }>;
        variants: Array<{ sku: string; flavor: string; size: { value: number; unit: string }; price: number; stock: number; images?: Array<{ url: string }> }>;
      } | null;
      if (!product) throw new Error(`Producto no encontrado: ${item.productId}`);
      const variant = product.variants.find((candidate) => candidate.sku === item.variantSku);
      if (!variant) throw new Error(`Variante no encontrada: ${item.variantSku}`);
      if (variant.stock < item.quantity) throw new Error(`Stock insuficiente: ${item.variantSku}`);
      const productId = String(product.id ?? product._id ?? item.productId);
      const lineTotal = Number((variant.price * item.quantity).toFixed(2));
      items.push({
        productId,
        variantSku: variant.sku,
        title: product.title,
        variantLabel: presentationLabel(variant.flavor, variant.size),
        image: variant.images?.[0]?.url ?? "",
        quantity: item.quantity,
        unitPrice: variant.price,
        lineTotal,
        categories: product.categories
      });
    }

    const subtotal = Number(items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
    const settings = await commerceSettingsService.get();
    // Descuento de bienvenida (C46): solo primera compra de documento, celular y correo.
    let discount: AppliedDiscount | null = null;
    if (input.discountCode) {
      const check = evaluateCode(settings, input.discountCode, subtotal);
      if (!check.discount) throw new GraphQLError(check.message ?? "Código no válido.", { extensions: { code: "DISCOUNT_NOT_ELIGIBLE" } });
      if (await this.hasOrders(input.customer) || await redemptions.taken(personKeys(input.customer))) throw notEligible(check.discount.code);
      discount = check.discount;
      const shares = prorate(items.map(item => item.lineTotal), discount.amount);
      items.forEach((item, index) => { item.discount = shares[index]; });
    }
    // Envío gratis y mínimos se evalúan con lo que se paga por los productos.
    const productsTotal = Number((subtotal - (discount?.amount ?? 0)).toFixed(2));
    const restriction = paymentRestriction(settings, input.paymentMethod, input.shippingMethod, productsTotal);
    if (restriction) throw new GraphQLError(restriction, { extensions: { code: "PAYMENT_NOT_ALLOWED" } });
    const shippingFee = feeFor(settings, input.shippingMethod, productsTotal);
    const total = Number((productsTotal + shippingFee).toFixed(2));
    if (input.expectedTotal !== undefined && Math.round(input.expectedTotal * 100) !== Math.round(total * 100)) {
      throw new GraphQLError("El total cambió. Revisa el importe actualizado antes de confirmar; no se creó un pedido.", { extensions: { code: "CART_TOTAL_CHANGED" } });
    }
    // Reservation, order and movement writes share the same transaction.
    await productService.reserveStock(items);
    for (const item of items) item.unitCost = item.allocations?.length && item.allocations.every(l => l.unitCost != null) ? item.allocations.reduce((sum, l) => sum + l.quantity * l.unitCost!, 0) / item.quantity : null;

    const payload = {
      ...(requestKey ? { requestKey, requestFingerprint } : {}),
      history: [{ from: "", to: "PENDING_PAYMENT", at: new Date(), actorId: operationContext.getStore()!.actorId, reason: "Pedido creado" }],
      orderNumber: orderNumber(),
      userId: user?.role === "CUSTOMER" ? user.id : null,
      customer: input.customer,
      delivery,
      billing: input.billing ?? null,
      items,
      shippingMethod: input.shippingMethod,
      paymentMethod: input.paymentMethod,
      status: "PENDING_PAYMENT" as OrderStatus,
      subtotal,
      discount,
      shippingFee,
      total,
      notes: input.notes,
      paymentReference: input.paymentReference,
      stockReserved: true
    };

    try {
      const created = this.useMongo
        ? await OrderModel.create(payload)
        : this.pushMemoryOrder(payload);
      // Misma transacción: si la persona ya usó el beneficio, no se crea el pedido.
      if (discount) await redemptions.claim(personKeys(input.customer), discount.code, String((created as { id?: unknown; _id?: unknown }).id ?? (created as { _id?: unknown })._id), created.orderNumber);
      // Los avisos se guardan con el pedido y salen tras el commit, fuera del
      // camino de la respuesta; si un canal falla se reintentan (outbox.service).
      await this.notifyNewOrder(created as unknown as MailOrder & { id: unknown });
      return created;
    } catch (error) {
      // unitOfWork revierte conjuntamente pedido, reservas y movimientos.
      throw error;
    }
  }

  /**
   * CU07: entrega. Una dirección guardada se busca por id entre las del cliente con sesión y debe tener la versión
   * que vio; su contenido guardado reemplaza la ubicación enviada, así que no se puede usar un id con otro texto.
   * Respuesta igual para una dirección ajena o inexistente. El destinatario nunca cuenta para descuento ni límites:
   * esas reglas usan solo al comprador (`customer`).
   */
  private async resolveDelivery(input: CheckoutInput, user?: AuthUser | null): Promise<OrderDelivery | null> {
    const requested = input.delivery;
    if (!requested) return null;
    let { recipientName, recipientPhone } = requested;
    let addressId: string | null = null, addressLabel = "";
    if (requested.addressId) {
      if (user?.role !== "CUSTOMER") throw new GraphQLError("Entra a tu cuenta para usar tus direcciones guardadas.", { extensions: { code: "FORBIDDEN" } });
      const saved = (await customerProfileService.stored(user.id))?.addresses.find(address => address.id === requested.addressId);
      if (!saved) throw new GraphQLError("Esa dirección ya no está en tu cuenta. Elige otra o escríbela.", { extensions: { code: "BAD_USER_INPUT", field: "deliveryAddressId" } });
      const seen = Date.parse(requested.addressUpdatedAt ?? "");
      if (Number.isNaN(seen) || seen !== Date.parse(saved.updatedAt)) throw new GraphQLError("Tu dirección cambió mientras comprabas. Revísala antes de confirmar; no se creó un pedido.", { extensions: { code: "CONFLICT", field: "deliveryAddressId" } });
      Object.assign(input.customer, { province: saved.province, city: saved.city, address: saved.address, reference: saved.reference });
      if (!recipientName && saved.recipientName) { recipientName = saved.recipientName; recipientPhone = saved.recipientPhone; }
      addressId = saved.id; addressLabel = saved.label;
    }
    return recipientName || addressId ? { recipientName, recipientPhone, addressId, addressLabel } : null;
  }

  /** Unión de productos (C49): las líneas del origen pasan al destino; el SKU no cambia. */
  async reassignProduct(sourceId: string, targetId: string) {
    if (this.useMongo) return (await OrderModel.updateMany({ "items.productId": sourceId }, { $set: { "items.$[line].productId": targetId } }, { arrayFilters: [{ "line.productId": sourceId }] })).modifiedCount;
    let count = 0;
    for (const order of this.memory) if (order.items.some(item => item.productId === sourceId)) { order.items = order.items.map(item => item.productId === sourceId ? { ...item, productId: targetId } : item); count++; }
    return count;
  }

  /** ¿La persona (documento, celular o correo) ya tiene pedidos que no se cancelaron? */
  private async pendingOrders(customer: { idNumber: string; phone: string; email: string }) {
    const email = customer.email.trim().toLowerCase();
    if (this.useMongo) return OrderModel.countDocuments({ status: "PENDING_PAYMENT", $or: [{ "customer.idNumber": customer.idNumber }, { "customer.phone": customer.phone }, { "customer.email": email }] });
    return this.memory.filter(order => order.status === "PENDING_PAYMENT" && (order.customer.idNumber === customer.idNumber || order.customer.phone === customer.phone || order.customer.email.toLowerCase() === email)).length;
  }

  private async hasOrders(customer: { idNumber: string; phone: string; email: string }) {
    const email = customer.email.trim().toLowerCase();
    if (this.useMongo) return Boolean(await OrderModel.exists({ status: { $ne: "CANCELLED" }, $or: [{ "customer.idNumber": customer.idNumber }, { "customer.phone": customer.phone }, { "customer.email": email }] }));
    return this.memory.some(order => order.status !== "CANCELLED" && (order.customer.idNumber === customer.idNumber || order.customer.phone === customer.phone || order.customer.email.toLowerCase() === email));
  }

  /**
   * CUENTA-BIENVENIDA-01: ¿la persona con sesión ya compró? Misma regla que el descuento de bienvenida: un pedido
   * no cancelado de la cuenta o de su correo, celular o documento, o el beneficio ya usado. Los datos vacíos no
   * cuentan (un perfil sin cédula no debe coincidir con pedidos antiguos sin cédula).
   */
  async isReturningCustomer(userId: string, identity: { email: string; phone?: string; idNumber?: string }) {
    const email = identity.email.trim().toLowerCase(), phone = identity.phone?.trim() ?? "", idNumber = identity.idNumber?.trim() ?? "";
    const keys = [`email:${email}`, ...(phone ? [`phone:${phone}`] : []), ...(idNumber ? [`doc:${idNumber.toUpperCase()}`] : [])];
    if (await redemptions.taken(keys)) return true;
    if (this.useMongo) {
      const or: Record<string, unknown>[] = [{ userId }, { "customer.email": email }];
      if (phone) or.push({ "customer.phone": phone });
      if (idNumber) or.push({ "customer.idNumber": idNumber });
      return Boolean(await OrderModel.exists({ status: { $ne: "CANCELLED" }, $or: or }));
    }
    return this.memory.some(order => order.status !== "CANCELLED" && (order.userId === userId || order.customer.email.toLowerCase() === email || (phone && order.customer.phone === phone) || (idNumber && order.customer.idNumber === idNumber)));
  }

  private pushMemoryOrder(payload: Omit<MemoryOrder, "id" | "createdAt" | "updatedAt">) {
    const now = new Date();
    const created = { ...payload, id: memoryId(), createdAt: now, updatedAt: now };
    this.memory.unshift(created);
    return created;
  }

  private notifyNewOrder(order: MailOrder & { id: unknown }) {
    const orderId = String(order.id);
    return notificationOutbox.enqueue([
      { kind: "ORDER_CONFIRMATION", orderId, label: `confirmación del pedido ${order.orderNumber}` },
      { kind: "ORDER_OPERATOR_MAIL", orderId, label: `correo al operador del pedido ${order.orderNumber}` },
      { kind: "ORDER_TELEGRAM", orderId, label: `Telegram del pedido ${order.orderNumber}` }
    ], order);
  }

  /**
   * Listado paginado para el panel. `search` busca por numero de orden, nombre,
   * correo o telefono del cliente, que es como un operador busca un pedido.
   */
  async findByNumber(orderNumber: string) {
    if (this.useMongo) return OrderModel.findOne({ orderNumber }).lean();
    return this.memory.find(order => order.orderNumber === orderNumber) ?? null;
  }

  /**
   * Pedidos por transferencia sin pago creados antes de `cutoff` (máximo 200 por
   * pasada). Contra entrega se cobra al entregar: no vence por reserva.
   */
  /** Contra entrega sin confirmar por WhatsApp registrados antes de `cutoff` (C36). */
  async unconfirmedBefore(cutoff: Date): Promise<string[]> {
    if (this.useMongo) return (await OrderModel.find({ status: "PENDING_PAYMENT", paymentMethod: "CASH_ON_DELIVERY", confirmedAt: null, createdAt: { $lt: cutoff } }).sort({ createdAt: 1 }).limit(200).select({ _id: 1 }).lean()).map(order => String(order._id));
    return this.memory.filter(order => order.status === "PENDING_PAYMENT" && order.paymentMethod === "CASH_ON_DELIVERY" && !order.confirmedAt && new Date(order.createdAt).getTime() < cutoff.getTime()).slice(0, 200).map(order => String(order.id));
  }

  /**
   * El cliente confirmó por WhatsApp un pedido contra entrega (C36). Sin esto no
   * se puede preparar y se cancela solo al vencer el plazo. Repetirlo no cambia nada.
   */
  async confirmCashOnDelivery(id: string, raw: unknown): Promise<unknown> {
    if (!operationContext.getStore()) return unitOfWork(() => this.confirmCashOnDelivery(id, raw));
    const { location } = z.object({ location: z.string().trim().max(300).optional().default("") }).strict().parse(raw ?? {});
    const current = await this.get(id);
    if (!current) throw new Error("Pedido no encontrado");
    if (current.paymentMethod !== "CASH_ON_DELIVERY") throw new Error("Solo los pedidos contra entrega se confirman por WhatsApp.");
    if (current.confirmedAt) return current;
    if (current.status !== "PENDING_PAYMENT") throw new Error("El pedido ya no está pendiente: se canceló o cambió de estado.");
    const confirmedAt = new Date();
    const history = [...(current.history ?? []), { from: current.status, to: current.status, at: confirmedAt, actorId: operationContext.getStore()!.actorId, reason: "Confirmado por WhatsApp" }];
    if (this.useMongo) {
      const updated = await OrderModel.findOneAndUpdate({ _id: id, status: "PENDING_PAYMENT", confirmedAt: null }, { $set: { confirmedAt, deliveryLocation: location, history } }, { new: true }).lean();
      if (!updated) throw new Error("El pedido cambió mientras lo confirmabas. Recarga la lista.");
      return updated;
    }
    Object.assign(current, { confirmedAt, deliveryLocation: location, history, updatedAt: confirmedAt });
    return current;
  }

  async unpaidBefore(cutoff: Date): Promise<string[]> {
    if (this.useMongo) return (await OrderModel.find({ status: "PENDING_PAYMENT", paymentMethod: { $ne: "CASH_ON_DELIVERY" }, createdAt: { $lt: cutoff } }).sort({ createdAt: 1 }).limit(200).select({ _id: 1 }).lean()).map(order => String(order._id));
    return this.memory.filter(order => order.status === "PENDING_PAYMENT" && order.paymentMethod !== "CASH_ON_DELIVERY" && new Date(order.createdAt).getTime() < cutoff.getTime()).slice(0, 200).map(order => String(order.id));
  }

  async list(filters: { status?: OrderStatus; search?: string } = {}, pagination: { limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(pagination.limit ?? 40, 1), 200);
    const offset = Math.max(pagination.offset ?? 0, 0);

    if (this.useMongo) {
      const query: Record<string, unknown> = {};
      if (filters.status) query.status = filters.status;
      if (filters.search) {
        const pattern = new RegExp(escapeRegex(filters.search), "i");
        query.$or = [
          { orderNumber: pattern },
          { "customer.fullName": pattern },
          { "customer.email": pattern },
          { "customer.phone": pattern },
          // CU07: también quien recibe, si no es el comprador.
          { "delivery.recipientName": pattern },
          { "delivery.recipientPhone": pattern }
        ];
      }
      const [orders, totalCount] = await Promise.all([
        OrderModel.find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
        OrderModel.countDocuments(query)
      ]);
      return { orders, totalCount };
    }

    const search = filters.search?.toLocaleLowerCase();
    const filtered = this.memory.filter((order) =>
      (!filters.status || order.status === filters.status)
      && (!search || `${order.orderNumber} ${order.customer.fullName} ${order.customer.email} ${order.customer.phone} ${order.delivery?.recipientName ?? ""} ${order.delivery?.recipientPhone ?? ""}`.toLocaleLowerCase().includes(search))
    );
    return { orders: filtered.slice(offset, offset + limit), totalCount: filtered.length };
  }

  /**
   * Pedidos del cliente que esta en sesion. Se filtra solo por userId: cruzar
   * por correo dejaria que cualquiera se registre con el correo de otro y vea
   * sus compras. Los pedidos hechos sin sesion se enlazan con linkGuestOrders.
   */
  /**
   * CU09: pedidos del cliente del más reciente al más antiguo, con cursor estable (createdAt + id): dos pedidos
   * con la misma fecha no se omiten ni se repiten al pasar de página. Solo pedidos de `userId`.
   */
  async pageByUser(userId: string, raw: unknown) {
    const args = z.object({ first: z.number().int().min(1).max(20).default(10), after: z.string().max(200).nullish(), filter: z.enum(["ALL", "ACTIVE", "FINISHED", "CANCELLED"]).default("ALL") }).parse(raw ?? {});
    const badCursor = () => new GraphQLError("La lista cambió. Vuelve a cargar tus pedidos.", { extensions: { code: "BAD_USER_INPUT", field: "after" } });
    let cursor: { t: string; i: string } | null = null;
    if (args.after) {
      try { cursor = z.object({ t: z.string().datetime(), i: z.string().min(1).max(64) }).parse(JSON.parse(Buffer.from(args.after, "base64url").toString("utf8"))); }
      catch { throw badCursor(); }
    }
    const statuses = ORDER_GROUPS[args.filter];
    const encode = (order: { createdAt?: Date | string; id?: unknown; _id?: unknown }) => Buffer.from(JSON.stringify({ t: new Date(order.createdAt!).toISOString(), i: String(order._id ?? order.id) })).toString("base64url");
    let rows: Array<Record<string, any>>;
    if (this.useMongo) {
      if (cursor && !mongoose.isValidObjectId(cursor.i)) throw badCursor();
      const at = cursor ? new Date(cursor.t) : null;
      const query: Record<string, unknown> = { userId, ...(statuses ? { status: { $in: statuses } } : {}), ...(cursor ? { $or: [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: new mongoose.Types.ObjectId(cursor.i) } }] } : {}) };
      rows = await OrderModel.find(query).sort({ createdAt: -1, _id: -1 }).limit(args.first + 1).lean();
    } else {
      const key = (order: { createdAt: Date; id: string }) => [new Date(order.createdAt).toISOString(), order.id] as const;
      rows = this.memory
        .filter(order => order.userId === userId && (!statuses || statuses.includes(order.status)))
        .sort((a, b) => { const [ta, ia] = key(a), [tb, ib] = key(b); return tb.localeCompare(ta) || ib.localeCompare(ia); })
        .filter(order => { if (!cursor) return true; const [t, i] = key(order); return t < cursor.t || (t === cursor.t && i < cursor.i); })
        .slice(0, args.first + 1);
    }
    const hasMore = rows.length > args.first;
    const page = rows.slice(0, args.first);
    return { orders: page, hasMore, nextCursor: hasMore ? encode(page.at(-1)!) : null };
  }

  /** CU09: un pedido del cliente por número. Ajeno o inexistente: null, sin distinguir. */
  async findOwned(userId: string, rawNumber: unknown) {
    const number = z.string().trim().toUpperCase().regex(/^RE-\d{6}-[A-Z0-9]{3,10}$/).safeParse(rawNumber);
    if (!number.success) return null;
    const order = this.useMongo ? await OrderModel.findOne({ orderNumber: number.data, userId }).lean() : this.memory.find(o => o.orderNumber === number.data && o.userId === userId);
    return order ?? null;
  }

  async listByUser(userId: string, limit = 30) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    if (this.useMongo) return OrderModel.find({ userId }).sort({ createdAt: -1 }).limit(safeLimit).lean();
    return this.memory.filter((order) => order.userId === userId).slice(0, safeLimit);
  }

  /**
   * Enlaza a la cuenta pedidos hechos como invitado (C44). Hace falta el número
   * del pedido, que solo recibe quien compró, y que el correo del pedido sea el
   * de la cuenta: el correo solo no basta porque no se verifica al registrarse.
   * Un pedido que ya tiene dueño no cambia de cuenta.
   */
  async linkGuestOrders(user: { id: string; email: string }, rawNumbers: unknown): Promise<string[]> {
    if (!operationContext.getStore()) return unitOfWork(() => this.linkGuestOrders(user, rawNumbers));
    const numbers = [...new Set(z.array(z.string().trim().toUpperCase().regex(/^RE-\d{6}-[A-Z0-9]{3,10}$/, "Número de pedido no válido")).min(1).max(20).parse(rawNumbers))];
    const email = user.email.trim().toLowerCase();
    const linked: string[] = [];
    for (const orderNumber of numbers) {
      const current = await this.findByNumber(orderNumber) as null | { userId?: string | null; status: string; customer: { email: string }; history?: MemoryOrder["history"] };
      if (!current || current.userId || current.customer.email.toLowerCase() !== email) continue;
      const at = new Date();
      const history = [...(current.history ?? []), { from: current.status, to: current.status, at, actorId: operationContext.getStore()!.actorId, reason: "Vinculado a la cuenta del cliente" }];
      if (this.useMongo) {
        const updated = await OrderModel.findOneAndUpdate({ orderNumber, userId: null, "customer.email": email }, { $set: { userId: user.id, history } }, { new: true }).lean();
        if (updated) linked.push(orderNumber);
        continue;
      }
      Object.assign(current, { userId: user.id, history, updatedAt: at });
      linked.push(orderNumber);
    }
    return linked;
  }

  async assertVariantsUnused(productId: string, removedSkus: string[]) {
    if (!removedSkus.length) return;
    const used = this.useMongo
      ? await OrderModel.exists({ items: { $elemMatch: { productId, variantSku: { $in: removedSkus } } } })
      : this.memory.some((o) => o.items.some((i) => i.productId === productId && removedSkus.includes(i.variantSku)));
    if (used) throw new Error("No puedes quitar ni cambiar SKU presentes en pedidos. Conserva esas variantes con stock cero o archiva el producto.");
  }

  async forMediaReferences() {
    if (this.useMongo) return OrderModel.find({}).select("items.image").lean();
    return this.memory;
  }

  async forManagement(start: Date, end: Date) {
    if (this.useMongo) return OrderModel.find({ $or: [{createdAt: { $gte: start, $lt: end }},{paidAt: { $gte: start, $lt: end }}], status: { $in: ["PAID", "PREPARING", "SHIPPED", "COMPLETED"] } }).select("createdAt paidAt status items shippingFee returns").lean();
    return this.memory.filter((o) => o.createdAt >= start && o.createdAt < end || o.paidAt && o.paidAt >= start && o.paidAt < end);
  }

  async pendingSummary() {
    const statuses = ["PENDING_PAYMENT", "PAYMENT_REVIEW", "PAID", "PREPARING", "SHIPPED"];
    if (this.useMongo) {
      const rows = await OrderModel.aggregate([{ $match: { status: { $in: statuses } } }, { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$total" } } }]);
      return statuses.map(status => { const row = rows.find(r => r._id === status); return { status, count: row?.count ?? 0, amount: Math.round((row?.amount ?? 0) * 100) / 100 }; });
    }
    return statuses.map(status => { const rows = this.memory.filter(o => o.status === status); return { status, count: rows.length, amount: Math.round(rows.reduce((s, o) => s + o.total, 0) * 100) / 100 }; });
  }

  async editDetails(id: string, raw: unknown) {
    const patch = checkoutInputSchema.pick({ customer: true, notes: true, paymentReference: true }).parse(raw);
    const current = await this.get(id);
    if (!current) throw new Error("Pedido no encontrado");
    if (this.useMongo) return OrderModel.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true }).lean();
    Object.assign(current, patch, { updatedAt: new Date() });
    return current;
  }

  async get(id: string) {
    if (this.useMongo) {
      if (!mongoose.isValidObjectId(id)) return null;
      return OrderModel.findById(id).lean();
    }
    return this.memory.find((order) => order.id === id) ?? null;
  }

  async reservedPositions() {
    const orders = this.useMongo
      ? await OrderModel.find({ status: { $in: reservedOrderStates }, stockReserved: { $ne: false } }).select("items").lean()
      : this.memory.filter(o => reservedOrderStates.includes(o.status) && o.stockReserved !== false);
    return orders.flatMap(o => o.items.flatMap(item => {
      const lots = item.allocations?.length ? item.allocations : [{ warehouseId: "main", lot: "INICIAL", expiresOn: "", unitCost: null, quantity: item.quantity }];
      return lots.map(lot => ({ ...lot, productId: item.productId, sku: item.variantSku, title: item.title }));
    }));
  }

  /** Totales para el resumen del panel, calculados sobre TODAS las ordenes. */
  async stats() {
    if (this.useMongo) {
      const [total, pendingPayment, paidAggregate] = await Promise.all([
        OrderModel.countDocuments({}),
        OrderModel.countDocuments({ status: "PENDING_PAYMENT" }),
        OrderModel.aggregate<{ revenue: number }>([
          { $match: { status: { $in: ["PAID", "PREPARING", "SHIPPED", "COMPLETED"] } } },
          { $group: { _id: null, revenue: { $sum: "$total" } } },
          { $project: { _id: 0, revenue: 1 } }
        ])
      ]);
      return { total, pendingPayment, revenue: Number((paidAggregate[0]?.revenue ?? 0).toFixed(2)) };
    }
    const paidStates: OrderStatus[] = ["PAID", "PREPARING", "SHIPPED", "COMPLETED"];
    const revenue = this.memory
      .filter((order) => paidStates.includes(order.status))
      .reduce((sum, order) => sum + order.total, 0);
    return {
      total: this.memory.length,
      pendingPayment: this.memory.filter((order) => order.status === "PENDING_PAYMENT").length,
      revenue: Number(revenue.toFixed(2))
    };
  }

  /** Cancelación antes del despacho. Una devolución se registra por separado. */
  /**
   * `expectedStatus` exige que el pedido siga en ese estado al cambiarlo: el
   * vencimiento automático solo cancela lo que sigue sin pago en ese instante.
   */
  async updateStatus(id: string, rawStatus: unknown, options: { reason?: string; expectedStatus?: OrderStatus; expectUnconfirmed?: boolean; expectNoProof?: boolean } = {}): Promise<unknown> {
    if (!operationContext.getStore()) return unitOfWork(() => this.updateStatus(id, rawStatus, options));
    const status = orderStatusSchema.parse(rawStatus);
    const current = await this.get(id);
    if (!current) throw new Error("Pedido no encontrado");
    if (options.expectedStatus && current.status !== options.expectedStatus) throw new Error("El pedido cambió de estado. Se omite.");
    if (current.status === status) return current;
    if (options.expectUnconfirmed && current.confirmedAt) throw new Error("El pedido ya fue confirmado. Se omite.");
    if (options.expectNoProof && current.paymentReference?.trim()) throw new Error("El pedido ya tiene comprobante. Se omite.");
    if (!nextStatuses(current.status as OrderStatus, current.paymentMethod, current.confirmedAt).includes(status)) throw new Error("Cambio de estado no permitido. Los pedidos enviados o completados requieren registrar una devolución; los cancelados conservan su historial.");
    const items = current.items.map((item) => ({ productId: item.productId, variantSku: item.variantSku, quantity: item.quantity, allocations: (item as unknown as OrderItem).allocations }));
    const reserved = current.stockReserved !== false;
    if (status === "CANCELLED" && reserved) await productService.releaseStock(items, options.reason ?? "Cancelación antes del despacho");
    // Un pedido cancelado devuelve el descuento de bienvenida a la persona (C46).
    if (status === "CANCELLED") await redemptions.release(id);
    const paidAt = current.paidAt ?? (paidStatesFor(current.paymentMethod).includes(status) ? new Date() : null);
    const nextItems = current.items.map((item, i) => { const allocations = items[i]?.allocations; const unitCost = status !== "CANCELLED" && !reserved ? (allocations?.length && allocations.every(l => l.unitCost != null) ? allocations.reduce((s,l)=>s+l.quantity*l.unitCost!,0)/item.quantity : null) : item.unitCost; return {...item, allocations, unitCost}; });
    const history = [...(current.history ?? []), { from: current.status, to: status, at: new Date(), actorId: operationContext.getStore()!.actorId, reason: options.reason ?? (status === "CANCELLED" ? "Cancelación antes del despacho" : "Cambio de estado") }];
    let updated;
    if (this.useMongo) {
      updated = await OrderModel.findOneAndUpdate({ _id: id, status: current.status, ...(options.expectUnconfirmed ? { confirmedAt: null } : {}), ...(options.expectNoProof ? { paymentReference: { $in: ["", null] } } : {}) }, { $set: { status, stockReserved: status !== "CANCELLED", paidAt, items: nextItems, history, transitionId: null } }, { new: true }).lean();
      if (!updated) throw new Error("El pedido cambió. Recarga antes de continuar.");
    } else { Object.assign(current, { status, stockReserved: status !== "CANCELLED", paidAt, items: nextItems, history, updatedAt: new Date() }); updated = current; }
    if (hasStatusMail(status)) await notificationOutbox.enqueue([{ kind: "ORDER_STATUS_MAIL", orderId: id, status, label: `correo «${status}» del pedido ${current.orderNumber}` }], updated as MailOrder);
    // CU12: cancelado por cualquier vía (equipo, vencimiento, cliente), su solicitud pendiente queda resuelta.
    if (status === "CANCELLED") await cancellationStore.settlePending(id, "Tu pedido fue cancelado.");
    // CU11: un pedido pagado o completado reinicia las cancelaciones seguidas de la cuenta (decisión del propietario).
    if ((status === "PAID" || status === "COMPLETED") && current.userId) await authService.resetCustomerCancellations(current.userId);
    return updated;
  }

  /**
   * CU11: cancelación directa del cliente (política del propietario, plan §8). En una transacción: comprueba dueño
   * y política con el estado actual, cancela con `updateStatus` (libera stock y descuento) condicionado a que siga
   * sin confirmar y sin comprobante, suma la cancelación y, si llega al límite, bloquea la cuenta y sus identidades
   * y avisa al operador. Un pedido ya cancelado devuelve un resultado estable sin otro movimiento.
   */
  async cancelByCustomer(user: AuthUser, rawNumber: unknown): Promise<{ order: unknown; alreadyCancelled: boolean; accountBlocked: boolean }> {
    if (!operationContext.getStore()) return unitOfWork(() => this.cancelByCustomer(user, rawNumber), { actorId: user.id, reason: "Cancelado por el cliente" });
    const order = await this.findOwned(user.id, rawNumber) as (MemoryOrder & { _id?: unknown }) | null;
    if (!order) throw new GraphQLError("No encontramos ese pedido en tu cuenta.", { extensions: { code: "BAD_USER_INPUT", field: "number" } });
    if (order.status === "CANCELLED") return { order, alreadyCancelled: true, accountBlocked: false };
    const policy = customerCancellation(order);
    if (!policy.canCancel) throw new GraphQLError(policy.reason ?? "Este pedido ya no se puede cancelar desde tu cuenta.", { extensions: { code: "NOT_CANCELLABLE" } });
    const id = String(order._id ?? order.id);
    let updated: unknown;
    try {
      updated = await this.updateStatus(id, "CANCELLED", { reason: "Cancelado por el cliente", expectedStatus: "PENDING_PAYMENT", expectUnconfirmed: true, expectNoProof: true });
    } catch {
      // Otra operación ganó (confirmación, comprobante, pago o vencimiento): se responde con el estado nuevo.
      throw new GraphQLError("Tu pedido cambió mientras lo cancelabas. Revisa su estado actual.", { extensions: { code: "CONFLICT" } });
    }
    const { blocked } = await authService.recordCustomerCancellation(user.id);
    if (blocked) {
      const own = this.useMongo ? await OrderModel.find({ userId: user.id }).select("customer").lean() : this.memory.filter(o => o.userId === user.id);
      const profile = await customerProfileService.stored(user.id);
      const keys = [`email:${user.email.trim().toLowerCase()}`, ...(profile?.phone ? [`phone:${profile.phone}`] : []), ...(profile?.altPhone ? [`phone:${profile.altPhone}`] : []), ...(profile?.billing?.idNumber ? [`doc:${profile.billing.idNumber.toUpperCase()}`] : []), ...own.flatMap(o => personKeys(o.customer as { idNumber: string; phone: string; email: string }))];
      await blockedIdentities.add(user.id, keys);
      await notificationOutbox.enqueue([{ kind: "OPERATOR_NOTICE", label: `aviso de cuenta bloqueada ${user.email}`, text: `Cuenta de cliente bloqueada por cancelaciones seguidas: ${user.email} (último pedido ${order.orderNumber}). Revísala y desbloquéala desde el panel si corresponde.` }]);
    }
    return { order: updated, alreadyCancelled: false, accountBlocked: blocked };
  }

  /**
   * Devolución recibida (M43). Sin `items` se devuelve todo lo pendiente, como antes; con `items` se devuelven
   * solo esas unidades. Al reponer, cada unidad vuelve a la capa de la que salió (fecha, costo y compra de
   * origen intactos), empezando por las últimas asignadas. El pedido pasa a RETURNED solo cuando vuelven todas.
   */
  async recordReturn(id: string, raw: unknown): Promise<unknown> {
    if (!operationContext.getStore()) return unitOfWork(() => this.recordReturn(id, raw));
    const input = z.object({
      reason: z.string().trim().min(5).max(300), restock: z.boolean(),
      items: z.array(z.object({ variantSku: z.string().min(1).max(80), quantity: z.number().int().min(1).max(100000) }).strict()).min(1).max(60).optional(),
      expectedReturns: z.number().int().min(0).max(1000).optional()
    }).strict().parse(raw);
    const current = await this.get(id);
    if (!current) throw new Error("Pedido no encontrado");
    if (current.returnInfo) return current;
    if (!["SHIPPED", "COMPLETED"].includes(current.status)) throw new Error("Solo se registra devolución de pedidos enviados o completados.");
    const previous = ((current as { returns?: OrderReturn[] }).returns ?? []) as OrderReturn[];
    if (input.expectedReturns !== undefined && input.expectedReturns !== previous.length) throw new Error("Se registró otra devolución de este pedido. Recarga antes de continuar.");
    const items = current.items as unknown as OrderItem[];
    const returned = (sku: string) => previous.reduce((s, r) => s + r.items.filter(i => i.variantSku === sku).reduce((n, i) => n + i.quantity, 0), 0);
    const requested = input.items ?? items.map(i => ({ variantSku: i.variantSku, quantity: i.quantity - returned(i.variantSku) })).filter(i => i.quantity > 0);
    if (!requested.length) throw new Error("No quedan unidades por devolver en este pedido.");
    const warehouses = await supplyService.warehouses();
    const at = new Date();
    const entryItems: OrderReturn["items"] = [];
    for (const want of requested) {
      const item = items.find(i => i.variantSku === want.variantSku);
      if (!item) throw new Error(`El pedido no tiene la presentación ${want.variantSku}.`);
      const pending = item.quantity - returned(item.variantSku);
      if (want.quantity > pending) throw new Error(`${item.title}: solo quedan ${pending} unidades por devolver.`);
      // Capas a las que vuelven las unidades: las asignadas al pedido, de la última a la primera, sin repetir lo ya devuelto.
      const allocations = (item.allocations?.length ? item.allocations : [{ warehouseId: "main", lot: "INICIAL", expiresOn: "", unitCost: null, quantity: item.quantity }]).map(a => withLayer(a));
      const usedByLayer = new Map<string, number>();
      for (const r of previous) for (const i of r.items) if (i.variantSku === item.variantSku) for (const a of i.allocations) usedByLayer.set(`${a.warehouseId}:${withLayer(a).layerId}`, (usedByLayer.get(`${a.warehouseId}:${withLayer(a).layerId}`) ?? 0) + a.quantity);
      let need = want.quantity; const lots: StockLot[] = [];
      for (const alloc of [...allocations].reverse()) {
        const k = `${alloc.warehouseId}:${alloc.layerId}`, free = alloc.quantity - (usedByLayer.get(k) ?? 0), take = Math.min(free, need);
        if (take > 0) { lots.push({ ...alloc, quantity: take }); need -= take; }
        if (!need) break;
      }
      if (input.restock && lots.length) {
        const rerouted = lots.map(l => ({ ...l, warehouseId: warehouses.some(w => w.id === l.warehouseId && w.active) ? l.warehouseId : "main" }));
        await productService.changeStock(item.productId, item.variantSku, want.quantity, { exactLots: rerouted, reason: `Devolución recibida (${current.orderNumber}): ${input.reason}${rerouted.some((l, i) => l.warehouseId !== lots[i]!.warehouseId) ? "; destino principal por bodega archivada" : ""}` });
      }
      const net = Math.round((item.lineTotal - (item.discount ?? 0)) * 100) / 100;
      entryItems.push({ productId: item.productId, variantSku: item.variantSku, title: item.title, quantity: want.quantity, allocations: lots, value: Math.round(net * want.quantity / item.quantity * 100) / 100 });
    }
    const entry: OrderReturn = { at, reason: input.reason, restocked: input.restock, items: entryItems };
    const all = [...previous, entry];
    const complete = items.every(i => i.quantity === all.reduce((s, r) => s + r.items.filter(x => x.variantSku === i.variantSku).reduce((n, x) => n + x.quantity, 0), 0));
    const actorId = operationContext.getStore()!.actorId;
    const patch = {
      returns: all,
      history: [...(current.history ?? []), { from: current.status, to: complete ? "RETURNED" : current.status, at, actorId, reason: complete ? input.reason : `Devolución parcial (${entryItems.map(i => `${i.quantity} × ${i.title}`).join(", ")}): ${input.reason}` }],
      ...(complete ? { status: "RETURNED" as const, stockReserved: false, returnInfo: { at, reason: input.reason, restocked: input.restock } } : {})
    };
    if (this.useMongo) {
      const result = await OrderModel.findOneAndUpdate({ _id: id, status: current.status, $or: [{ returns: { $size: previous.length } }, ...(previous.length ? [] : [{ returns: { $exists: false } }])] }, { $set: patch }, { new: true }).lean();
      if (!result) throw new Error("El pedido cambió. Recarga antes de continuar.");
      return result;
    }
    Object.assign(current, patch, { updatedAt: at }); return current;
  }

  async recordRefund(id: string, raw: unknown): Promise<unknown> {
    if (!operationContext.getStore()) return unitOfWork(() => this.recordRefund(id, raw));
    const input = z.object({ reason: z.string().trim().min(5).max(300), reference: z.string().trim().min(3).max(120) }).strict().parse(raw);
    const current = await this.get(id);
    if (!current) throw new Error("Pedido no encontrado");
    if (current.refund) return current;
    if (!["CANCELLED", "RETURNED"].includes(current.status) || !current.paidAt) throw new Error("El reembolso requiere un pedido pagado y cancelado o devuelto.");
    const at = new Date();
    const patch = { refund: { ...input, at, amount: current.total }, history: [...(current.history ?? []), { from: current.status, to: current.status, at, actorId: operationContext.getStore()!.actorId, reason: `Reembolso registrado: ${input.reason}` }] };
    if (this.useMongo) return OrderModel.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
    Object.assign(current, patch, { updatedAt: at }); return current;
  }

}

export const orderService = new OrderService();
notificationOutbox.useOrderLoader(id => orderService.get(id));
