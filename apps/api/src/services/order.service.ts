import { unitOfWork, operationContext, registerMemoryStore } from "../lib/unitOfWork.js";
import type { StockLot } from "./stockLedger.service.js";
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

type MemoryOrder = {
  id: string;
  orderNumber: string;
  userId?: string | null;
  customer: CheckoutInput["customer"];
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
    return mongoose.connection.readyState === 1;
  }

  async create(rawInput: unknown, user?: AuthUser | null, options: { beforeNew?: () => Promise<void> } = {}): Promise<MemoryOrder | import("mongoose").HydratedDocument<import("../models/Order.js").OrderDocument>> {
    if (!operationContext.getStore()) return unitOfWork(() => this.create(rawInput, user, options));
    const input = checkoutInputSchema.parse(rawInput);
    const { idempotencyKey, ...request } = input;
    const requestKey = idempotencyKey ? createHash("sha256").update(`${user?.id ?? "guest"}:${idempotencyKey}`).digest("hex") : undefined;
    const requestFingerprint = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    if (requestKey) {
      const previous = this.useMongo ? await OrderModel.findOne({ requestKey }) : this.memory.find(o => o.requestKey === requestKey);
      if (previous) {
        if (previous.requestFingerprint !== requestFingerprint) throw new Error("Este intento de compra ya se usó con otros datos. Revisa el pedido anterior antes de crear otro.");
        return previous;
      }
    }
    // Pedido nuevo (no es un reintento): comprobación de persona si está activa (C70).
    await options.beforeNew?.();
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
          { "customer.phone": pattern }
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
      && (!search || `${order.orderNumber} ${order.customer.fullName} ${order.customer.email} ${order.customer.phone}`.toLocaleLowerCase().includes(search))
    );
    return { orders: filtered.slice(offset, offset + limit), totalCount: filtered.length };
  }

  /**
   * Pedidos del cliente que esta en sesion. Se filtra solo por userId: cruzar
   * por correo dejaria que cualquiera se registre con el correo de otro y vea
   * sus compras. Los pedidos hechos sin sesion se enlazan con linkGuestOrders.
   */
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
    if (this.useMongo) return OrderModel.find({ $or: [{createdAt: { $gte: start, $lt: end }},{paidAt: { $gte: start, $lt: end }}], status: { $in: ["PAID", "PREPARING", "SHIPPED", "COMPLETED"] } }).select("createdAt paidAt status items shippingFee").lean();
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
  async updateStatus(id: string, rawStatus: unknown, options: { reason?: string; expectedStatus?: OrderStatus; expectUnconfirmed?: boolean } = {}): Promise<unknown> {
    if (!operationContext.getStore()) return unitOfWork(() => this.updateStatus(id, rawStatus, options));
    const status = orderStatusSchema.parse(rawStatus);
    const current = await this.get(id);
    if (!current) throw new Error("Pedido no encontrado");
    if (options.expectedStatus && current.status !== options.expectedStatus) throw new Error("El pedido cambió de estado. Se omite.");
    if (current.status === status) return current;
    if (options.expectUnconfirmed && current.confirmedAt) throw new Error("El pedido ya fue confirmado. Se omite.");
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
      updated = await OrderModel.findOneAndUpdate({ _id: id, status: current.status, ...(options.expectUnconfirmed ? { confirmedAt: null } : {}) }, { $set: { status, stockReserved: status !== "CANCELLED", paidAt, items: nextItems, history, transitionId: null } }, { new: true }).lean();
      if (!updated) throw new Error("El pedido cambió. Recarga antes de continuar.");
    } else { Object.assign(current, { status, stockReserved: status !== "CANCELLED", paidAt, items: nextItems, history, updatedAt: new Date() }); updated = current; }
    if (hasStatusMail(status)) await notificationOutbox.enqueue([{ kind: "ORDER_STATUS_MAIL", orderId: id, status, label: `correo «${status}» del pedido ${current.orderNumber}` }], updated as MailOrder);
    return updated;
  }

  async recordReturn(id: string, raw: unknown): Promise<unknown> {
    if (!operationContext.getStore()) return unitOfWork(() => this.recordReturn(id, raw));
    const input = z.object({ reason: z.string().trim().min(5).max(300), restock: z.boolean() }).strict().parse(raw);
    const current = await this.get(id);
    if (!current) throw new Error("Pedido no encontrado");
    if (current.returnInfo) return current;
    if (!["SHIPPED", "COMPLETED"].includes(current.status)) throw new Error("Solo se registra devolución de pedidos enviados o completados.");
    if (input.restock) await productService.releaseStock(current.items as unknown as OrderItem[], `Devolución recibida: ${input.reason}`);
    const at = new Date();
    const patch = { status: "RETURNED" as const, stockReserved: false, returnInfo: { at, reason: input.reason, restocked: input.restock }, history: [...(current.history ?? []), { from: current.status, to: "RETURNED", at, actorId: operationContext.getStore()!.actorId, reason: input.reason }] };
    if (this.useMongo) {
      const result = await OrderModel.findOneAndUpdate({ _id: id, status: current.status }, { $set: patch }, { new: true }).lean();
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
