import { nextStatuses, orderStatusSchema, type OrderStatus } from "../validation/order.js";
import { purchaseResultsService } from "../services/purchaseResults.service.js";
import { exchangeService } from "../services/exchange.service.js";
import { inventoryAgingService } from "../services/inventoryAging.service.js";
import { purchaseImportService } from "../services/purchaseImport.service.js";
import { permissions } from "../services/permissions.js";
import { unitOfWork } from "../lib/unitOfWork.js";
import { supplyService } from "../services/supply.service.js";
import { homeService } from "../services/home.service.js";
import { productPayloadSchema } from "../validation/product.js";
import { GraphQLError } from "graphql";
import { ZodError, z } from "zod";
import { env } from "../config/env.js";
import { authService, customerAccountsEnabled, accountsOffMessage, mfaSetupPending, staffMfaRequired, type AuthRole, type AuthUser } from "../services/auth.service.js";
import { mailService } from "../services/mail.service.js";
import { customerProfileService } from "../services/customerProfile.service.js";
import { customerOrderView, orderInvoice, orderRecipient } from "../services/customerOrders.js";
import { blockedIdentities, blockedMessage } from "../services/blockedIdentities.js";
import { cancellationRequestService } from "../services/cancellationRequest.service.js";
import { cancellationStore } from "../services/cancellationRequests.store.js";
import { personKeys } from "../services/welcomeDiscount.service.js";
import { telegramService } from "../services/telegram.service.js";
import { orderService } from "../services/order.service.js";
import { productService } from "../services/product.service.js";
import { auditService, redact, type AuditContext } from "../services/audit.service.js";
import { managementService } from "../services/management.service.js";
import { mediaService } from "../services/media.service.js";
import { mergeProducts } from "../services/productMerge.service.js";
import { jsonScalar } from "./jsonScalar.js";
import { clientKey, operationLimiter } from "../lib/operationLimiter.js";
import { trustedLogins } from "../lib/trustedLogins.js";
import { turnstileEnabled, verifyHuman } from "../lib/turnstile.js";
import { securityAlerts } from "../services/securityAlerts.service.js";
import { MAX_CHECKOUT_LINES, MAX_UNITS_PER_LINE } from "../validation/order.js";
import { expenseService } from "../services/expense.service.js";
import { commercialService } from "../services/commercial.service.js";
import { campaignService, campaignStatus, ecuadorToday, type Campaign } from "../services/campaign.service.js";
import { commerceSettingsService } from "../services/commerceSettings.service.js";
import { notificationOutbox } from "../services/outbox.service.js";
import { emailDomainService } from "../services/emailDomain.service.js";
import { emailProblem, emailSuggestion } from "../data/ecuador.js";
import { publicMediaUrl } from "../lib/mediaUrl.js";

const goalArgs = z.object({ goalSlug: z.string().regex(/^[a-z0-9-]+$/), limit: z.number().int().min(1).max(24).default(8) });
const searchArgs = z.object({
  filters: z.object({
    search: z.string().max(80).optional(),
    brands: z.array(z.string().max(80)).max(12).optional(),
    goals: z.array(z.string()).max(12).optional(),
    categories: z.array(z.string().regex(/^[a-z0-9-]+$/).max(80)).max(12).optional(),
    flavors: z.array(z.string()).max(20).optional(),
    status: z.enum(["ACTIVE", "ARCHIVED", "ALL"]).optional(),
    sort: z.enum(["PRICE_ASC", "PRICE_DESC"]).optional(),
    minPrice: z.number().nonnegative().max(1000000).optional(),
    maxPrice: z.number().nonnegative().max(1000000).optional(),
    inStock: z.boolean().optional(),
    featured: z.boolean().optional()
  }).optional(),
  pagination: z.object({ first: z.number().int().min(1).max(100).optional(), after: z.string().max(300).optional() }).optional()
});
const cartArgs = z.object({
  cartItems: z.array(z.object({ productId: z.string(), variantSku: z.string().min(3), quantity: z.number().int().min(1).max(MAX_UNITS_PER_LINE) })).max(MAX_CHECKOUT_LINES),
  shippingMethod: z.enum(["EXPRESS_QUITO_VALLES", "SERVIENTREGA_NATIONAL"]).optional(),
  discountCode: z.string().trim().max(30).nullish()
});
const idArgs = z.object({ id: z.string().min(1).max(80) });
const slugArgs = z.object({ slug: z.string().min(1).max(160).regex(/^[a-z0-9-]+$/) });
const orderStatusArgs = z.object({
  id: z.string().min(1).max(80),
  status: orderStatusSchema
});
const userArgs = z.object({ role: z.enum(["CUSTOMER", "CATALOG", "WAREHOUSE", "MANAGER", "STORE_MANAGER", "ADMIN"]).optional() });
const orderListArgs = z.object({
  filters: z.object({
    status: orderStatusSchema.optional(),
    search: z.string().max(80).optional()
  }).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional()
});
const myOrdersArgs = z.object({ limit: z.number().int().min(1).max(100).optional() });
const taxonomyArgs = z.object({
  kind: z.enum(["CATEGORY", "GOAL", "BRAND"]),
  action: z.enum(["RENAME", "MERGE", "REMOVE"]),
  key: z.string().min(1).max(120),
  target: z.string().min(1).max(120).optional()
}).refine((value) => value.action === "REMOVE" || Boolean(value.target), {
  message: "Renombrar y fusionar necesitan un destino",
  path: ["target"]
});
const userStatusArgs = z.object({ id: z.string().min(1).max(80), status: z.enum(["ACTIVE", "BLOCKED"]) });
const userRoleArgs = z.object({ id: z.string().min(1).max(80), role: z.enum(["CUSTOMER", "CATALOG", "WAREHOUSE", "MANAGER", "STORE_MANAGER", "ADMIN"]) });
type ResolverContext = AuditContext & { user?: AuthUser | null };

const safe = async <T>(action: () => Promise<T>) => {
  try { return await action(); }
  catch (error) {
    if (error instanceof ZodError) throw new GraphQLError("Datos de entrada inválidos", { extensions: { code: "BAD_USER_INPUT", issues: error.issues } });
    throw error;
  }
};

const productId = (product: { id?: unknown; _id?: unknown }) => String(product.id ?? product._id);
const orderId = (order: { id?: unknown; _id?: unknown }) => String(order.id ?? order._id);
const dateString = (value?: Date | string | null) => value ? new Date(value).toISOString() : null;
const PUBLIC_STOCK_CAP = MAX_UNITS_PER_LINE;
const isStaff = (context: ResolverContext) => Boolean(context.user && context.user.role !== "CUSTOMER" && !mfaSetupPending(context.user));

const baseResolvers = {
  JSON: jsonScalar,
  User: { createdAt: (user: AuthUser) => dateString(user.createdAt), lastLoginAt: (user: AuthUser) => dateString(user.lastLoginAt), twoFactorEnabled: (user: AuthUser) => Boolean(user.twoFactorEnabled), twoFactorRequired: (user: AuthUser) => user.role !== "CUSTOMER" && staffMfaRequired(), emailVerified: (user: AuthUser) => user.role !== "CUSTOMER" || Boolean(user.emailVerified) },
  Campaign: {
    imageUrl: (campaign: Campaign) => publicMediaUrl(campaign.imageUrl || null),
    products: (campaign: Campaign, args: { limit?: number }) => safe(() => campaignService.products(campaign, z.number().int().min(1).max(24).parse(args.limit ?? 8)))
  },
  Product: {
    revision: (product: {revision?:number}) => product.revision ?? 0,
    id: productId,
    primaryImage: (product: { variants?: Array<{ images?: Array<{ url: string; alt: string }> }> }) => product.variants?.find((variant) => variant.images?.length)?.images?.[0] ?? null,
    // Campos retirados en C67: valor fijo para clientes publicados antes del cambio.
    vitalCoinsReward: () => 0,
    maxInstallments: () => 1,
    hasFreeShipping: () => false,
    storeBadges: () => []
  },
  ProductVariant: {
    id: (variant: { id?: unknown; _id?: unknown; sku: string }) => String(variant.id ?? variant._id ?? variant.sku),
    // C60 (S12): el público ve la disponibilidad acotada (bastan para «Quedan N» y para el tope por
    // línea) y no el punto de reposición; el personal ve las cifras exactas.
    stock: (variant: { stock: number }, _: unknown, context: ResolverContext) => isStaff(context) ? variant.stock : Math.min(variant.stock, PUBLIC_STOCK_CAP),
    reorderPoint: (variant: { reorderPoint?: number | null }, _: unknown, context: ResolverContext) => isStaff(context) ? variant.reorderPoint ?? null : null,
    sizeValue: (variant: { size: { value: number } }) => variant.size.value,
    sizeUnit: (variant: { size: { unit: string } }) => variant.size.unit,
    // Version plana de images: atravesar variants { images { url } } pasa del
    // limite de profundidad, asi que el catalogo se quedaba sin las fotos.
    imageAlts: (variant: { images?: Array<{ alt: string }> }) => variant.images?.map(image => image.alt) ?? [],
    imageUrls: (variant: { images?: Array<{ url: string }> }) => variant.images?.map((image) => publicMediaUrl(image.url)) ?? []
  },
  ProductImage: { url: (image: { url: string }) => publicMediaUrl(image.url) },
  OrderItem: { image: (item: { image?: string | null }) => publicMediaUrl(item.image ?? null) },
  CustomerProfile: {
    // CUENTA-BIENVENIDA-01: misma regla que aplica el descuento al confirmar; solo se calcula si se pide.
    firstPurchase: async (profile: { email: string; phone: string; billing?: { idNumber?: string } | null }, _: unknown, context: ResolverContext) =>
      !context.user || !(await orderService.isReturningCustomer(context.user.id, { email: profile.email, phone: profile.phone, idNumber: profile.billing?.idNumber }))
  },
  Order: {
    paidAt: (order: {paidAt?: Date | null}) => dateString(order.paidAt),
    allowedNextStatuses: (order: { status: OrderStatus; paymentMethod?: string; confirmedAt?: Date | null }) => nextStatuses(order.status, order.paymentMethod, order.confirmedAt),
    confirmedAt: (order: { confirmedAt?: Date | null }) => dateString(order.confirmedAt),
    // CU07: adaptador para pedidos anteriores, que solo tienen `customer`.
    recipient: orderRecipient,
    invoice: orderInvoice,
    operations: (order: { history?: unknown; returnInfo?: unknown; refund?: unknown; returns?: unknown[] }, _: unknown, context: ResolverContext) => { authService.requirePermission(context.user, "orders.read"); return { history: order.history ?? [], returnInfo: order.returnInfo ?? null, refund: order.refund ?? null, returns: (order.returns ?? []).map(r => { const x = r as { at: Date; reason: string; restocked: boolean; items: Array<{ variantSku: string; title: string; quantity: number; value: number }> }; return { at: x.at, reason: x.reason, restocked: x.restocked, items: x.items.map(i => ({ variantSku: i.variantSku, title: i.title, quantity: i.quantity, value: i.value })) }; }) }; },
    id: orderId,
    createdAt: (order: { createdAt?: Date | string | null }) => dateString(order.createdAt),
    updatedAt: (order: { updatedAt?: Date | string | null }) => dateString(order.updatedAt)
  },
  Query: {
    commercialOverview: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "management.read"); return commercialService.overview(); }),
    expenses: (_: unknown, args: { filters: unknown }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "management.read"); return expenseService.list(args.filters); }),
    staffHome: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => { const actor = authService.requireStaff(context.user); return homeService.overview(actor.role); }),
    order: (_: unknown, args: {id:string}, context: ResolverContext) => safe(async()=>{authService.requirePermission(context.user,"orders.read");return orderService.get(idArgs.parse(args).id);}),
    mySessions: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => authService.sessions(authService.requireUser(context.user))),
    purchaseImports: (_: unknown, args: { limit?: number }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "purchases.read"); return purchaseImportService.list(z.number().int().min(1).max(50).parse(args.limit ?? 20)); }),
    purchaseImport: (_: unknown, args: { id: string }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "purchases.read"); const row = await purchaseImportService.get(idArgs.parse(args).id); return row ? purchaseImportService.refresh(row) : null; }),
    purchaseResults: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "management.read"); return purchaseResultsService.overview(); }),
    supplierExchanges: (_: unknown, args: { status?: string | null }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "purchases.read"); const status = z.enum(["ABIERTO", "REPUESTO", "CERRADO", "CERRADO_CON_DIFERENCIA", "ANULADO"]).optional().parse(args.status ?? undefined); return { exchanges: await exchangeService.list(status), pending: await exchangeService.pendingBalance() }; }),
    inventoryAging: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "inventory.read"); return inventoryAgingService.overview(); }),
    supplyOverview: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "purchases.read"); return supplyService.overview(); }),
    stockMovements: (_: unknown, args: { filters?: unknown }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "inventory.read"); const filters = z.object({ productId: z.string().optional(), sku: z.string().optional(), search: z.string().max(120).optional(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(100).optional() }).parse(args.filters ?? {}); return supplyService.listMovements(filters); }),
    inventoryOverview: (_: unknown, args: { filters: unknown }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "inventory.read"); return managementService.inventory(args.filters); }),
    managementDashboard: (_: unknown, args: { filters: unknown }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "management.read"); return managementService.dashboard(args.filters); }),
    auditEvents: (_: unknown, args: { filters?: unknown }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "audit.read"); return auditService.list(args.filters ?? {}); }),
    accounts: (_: unknown, args: { filters?: unknown }, context: ResolverContext) => safe(async () => { authService.requireAdmin(context.user); return authService.listAccounts(args.filters ?? {}); }),
    databaseRecords: (_: unknown, args: { entity: string; filters?: unknown }, context: ResolverContext) => safe(async () => {
      if(args.entity === "media") authService.requirePermission(context.user, "catalog.read"); else authService.requireAdmin(context.user);
      const f = z.object({ search: z.string().max(120).default(""), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(30), after: z.string().max(300).optional() }).parse(args.filters ?? {});
      if (args.entity === "users") return authService.listAccounts(f);
      if (args.entity === "expenses") return expenseService.list({ ...f, status: "ALL" });
      if (args.entity === "media") return mediaService.list(f.offset, f.limit, f.search);
      if (args.entity === "orders") { const result = await orderService.list({ search: f.search }, f); return redact({ rows: result.orders.map((o) => ({ ...o, id: String("id" in o ? o.id : o._id) })), total: result.totalCount }); }
      if (args.entity === "products") { const result = await productService.search({ search: f.search, status: "ALL" }, { first: f.limit, after: f.after }); return redact({ rows: result.edges.map((e) => ({ ...e.node, id: String("id" in e.node ? e.node.id : e.node._id) })), total: result.totalCount, pageInfo: result.pageInfo }); }
      if (args.entity === "suppliers") { const rows = (await supplyService.suppliers()).filter(r=>`${r.name} ${r.email} ${r.id}`.toLowerCase().includes(f.search.toLowerCase())); return { rows: rows.slice(f.offset, f.offset + f.limit), total: rows.length }; }
      if (args.entity === "warehouses") { const rows = (await supplyService.warehouses()).filter(r=>`${r.name} ${r.id}`.toLowerCase().includes(f.search.toLowerCase())); return { rows: rows.slice(f.offset, f.offset + f.limit), total: rows.length }; }
      if (args.entity === "purchases") { const rows = (await supplyService.purchases()).filter(r=>`${r.number} ${r.id} ${r.items.map(i=>i.sku).join(" ")}`.toLowerCase().includes(f.search.toLowerCase())); return { rows: rows.slice(f.offset, f.offset + f.limit), total: rows.length }; }
      if (args.entity === "movements") return supplyService.listMovements(f);
      if (args.entity === "audit") return auditService.list(f);
      throw new Error("Colección no administrable");
    }),
    health: () => "ok",
    me: (_: unknown, __: unknown, context: ResolverContext) => context.user ?? null,
    users: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(() => {
      authService.requireAdmin(context.user);
      const args = userArgs.parse(rawArgs);
      return authService.users(args.role as AuthRole | undefined);
    }),
    product: (_: unknown, rawArgs: unknown) => safe(() => { const args = idArgs.parse(rawArgs); return productService.getSellable(args.id); }),
    productBySlug: (_: unknown, rawArgs: unknown) => safe(() => { const args = slugArgs.parse(rawArgs); return productService.getSellableBySlug(args.slug); }),
    storeLegal: () => ({ storeName: env.STORE_NAME, legalName: env.STORE_LEGAL_NAME ?? null, ruc: env.STORE_RUC ?? null, address: env.STORE_ADDRESS ?? null, email: env.STORE_CONTACT_EMAIL ?? null, whatsapp: env.STORE_WHATSAPP ?? null, reservationHours: env.ORDER_RESERVATION_HOURS }),
    // Un invitado consulta su pedido con número + correo o teléfono de la compra. Si no
    // coincide responde null, igual que si no existe, para no revelar pedidos ajenos.
    trackOrder: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(async () => {
      operationLimiter.consume("orderLookup", clientKey(context.ip));
      const args = z.object({ orderNumber: z.string().trim().min(5).max(30), contact: z.string().trim().min(5).max(120) }).parse(rawArgs);
      const order = await orderService.findByNumber(args.orderNumber.toUpperCase()) as null | { orderNumber: string; status: string; paymentMethod?: string; confirmedAt?: Date | null; createdAt: Date | string; shippingMethod: string; subtotal: number; shippingFee: number; total: number; customer: { email: string; phone: string }; items: Array<{ title: string; variantLabel: string; quantity: number; lineTotal: number }> };
      if (!order) return null;
      const phone = (value: string) => value.replace(/\D/g, "").replace(/^593/, "").replace(/^0/, "");
      const matches = args.contact.includes("@")
        ? args.contact.toLowerCase() === order.customer.email.toLowerCase()
        : phone(args.contact).length >= 7 && phone(args.contact) === phone(order.customer.phone);
      if (!matches) return null;
      // CU11: con número y contacto correctos, una identidad bloqueada recibe el mensaje neutral, no el pedido.
      if (await blockedIdentities.any(personKeys(order.customer as { idNumber: string; phone: string; email: string }))) throw new GraphQLError(blockedMessage, { extensions: { code: "ACCOUNT_BLOCKED" } });
      const created = new Date(order.createdAt);
      return {
        orderNumber: order.orderNumber, status: order.status, paymentMethod: order.paymentMethod ?? "BANK_TRANSFER", createdAt: created.toISOString(),
        // Transferencia: plazo de pago. Contra entrega sin confirmar: plazo para confirmar por WhatsApp.
        reservedUntil: order.status !== "PENDING_PAYMENT" ? null
          : order.paymentMethod !== "CASH_ON_DELIVERY" ? new Date(created.getTime() + env.ORDER_RESERVATION_HOURS * 3600000).toISOString()
          : order.confirmedAt ? null : new Date(created.getTime() + (await commerceSettingsService.get()).cashOnDelivery.confirmHours * 3600000).toISOString(),
        awaitingConfirmation: order.status === "PENDING_PAYMENT" && order.paymentMethod === "CASH_ON_DELIVERY" && !order.confirmedAt,
        shippingMethod: order.shippingMethod, subtotal: order.subtotal, discount: (order as { discount?: unknown }).discount ?? null, shippingFee: order.shippingFee, total: order.total,
        items: order.items.map(item => ({ title: item.title, variantLabel: item.variantLabel, quantity: item.quantity, lineTotal: item.lineTotal }))
      };
    }),
    // Solo campañas activas y dentro de sus fechas: las pausadas o programadas no son públicas.
    activeCampaigns: () => campaignService.live(),
    campaign: (_: unknown, rawArgs: unknown) => safe(() => campaignService.liveBySlug(slugArgs.parse(rawArgs).slug)),
    adminCampaigns: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => {
      authService.requirePermission(context.user, "catalog.read");
      const today = ecuadorToday();
      return { today, rows: (await campaignService.all()).map(campaign => ({ ...campaign, status: campaignStatus(campaign, today) })) };
    }),
    getProductsByGoal: (_: unknown, rawArgs: unknown) => safe(() => { const args = goalArgs.parse(rawArgs); return productService.byGoal(args.goalSlug, args.limit); }),
    searchProducts: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(() => {
      const args = searchArgs.parse(rawArgs);
      if (args.filters?.status && args.filters.status !== "ACTIVE") authService.requirePermission(context.user, "catalog.read");
      return productService.search(args.filters, args.pagination);
    }),
    calculateCartTotals: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(() => { operationLimiter.consume("cartTotals", clientKey(context.ip)); const { cartItems, shippingMethod, discountCode } = cartArgs.parse(rawArgs); return productService.calculateCart(cartItems, shippingMethod, undefined, discountCode); }),
    orders: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(() => {
      authService.requirePermission(context.user, "orders.read");
      const args = orderListArgs.parse(rawArgs);
      return orderService.list(args.filters, { limit: args.limit, offset: args.offset });
    }),
    myProfile: (_: unknown, __: unknown, context: ResolverContext) => safe(() => customerProfileService.get(context.user)),
    myOrdersPage: (_: unknown, args: unknown, context: ResolverContext) => safe(async () => {
      const user = authService.requireCustomer(context.user);
      const page = await orderService.pageByUser(user.id, args);
      const cancellations = await authService.customerCancellations(user.id);
      const requests = await cancellationStore.latestFor(page.orders.map(order => String(order._id ?? order.id)));
      return { ...page, orders: page.orders.map(order => customerOrderView(order as Parameters<typeof customerOrderView>[0], cancellations, requests.get(String(order._id ?? order.id)))) };
    }),
    myOrder: (_: unknown, args: { number: string }, context: ResolverContext) => safe(async () => {
      const user = authService.requireCustomer(context.user);
      const order = await orderService.findOwned(user.id, args.number);
      if (!order) return null;
      const id = String((order as { _id?: unknown; id?: unknown })._id ?? (order as { id?: unknown }).id);
      return customerOrderView(order as Parameters<typeof customerOrderView>[0], await authService.customerCancellations(user.id), (await cancellationStore.latestFor([id])).get(id));
    }),
    cancellationRequests: (_: unknown, args: { status?: string }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "orders.write"); return cancellationRequestService.list(args.status); }),
    myOrders: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(() => {
      const user = authService.requireUser(context.user);
      const args = myOrdersArgs.parse(rawArgs);
      return orderService.listByUser(user.id, args.limit);
    }),
    adminStats: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => {
      authService.requireAdmin(context.user);
      const [catalog, accounts, orders] = await Promise.all([
        productService.stats(),
        authService.stats(),
        orderService.stats()
      ]);
      return { catalog, accounts, orders };
    }),
    catalogBrands: () => productService.catalogBrands(),
    catalogCategories: () => productService.catalogCategories(),
    checkoutInfo: async () => {
      const settings = await commerceSettingsService.get();
      const { bank } = settings;
      return {
        bank: settings.showBankDetails && bank.name && bank.accountNumber && bank.holder ? { name: bank.name, accountType: bank.accountType, accountNumber: bank.accountNumber, holder: bank.holder } : null,
        notifiesByEmail: mailService.enabled, whatsapp: env.STORE_WHATSAPP ?? null,
        captchaSiteKey: turnstileEnabled() ? env.TURNSTILE_SITE_KEY : null,
        customerAccounts: customerAccountsEnabled(),
        freeShippingThreshold: settings.freeShippingThreshold, freeShippingMethods: settings.freeShippingMethods, reservationHours: env.ORDER_RESERVATION_HOURS,
        shippingRates: Object.entries(settings.shippingFees).map(([method, fee]) => ({ method, fee })),
        cashOnDelivery: settings.cashOnDelivery,
        welcomeDiscount: (() => {
          const offer = settings.welcomeDiscount;
          const expired = offer.endsOn && new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10) > offer.endsOn;
          return offer.enabled && !expired ? { percent: offer.percent, minimumSubtotal: offer.minimumSubtotal, endsOn: offer.endsOn, code: offer.showOnStore ? offer.code : null } : null;
        })()
      };
    },
    commerceSettings: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => { authService.requireAdmin(context.user); return commerceSettingsService.get(); }),
    checkEmail: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(async () => {
      operationLimiter.consume("emailCheck", clientKey(context.ip));
      const { email } = z.object({ email: z.string().trim().max(200) }).parse(rawArgs);
      const suggestion = emailSuggestion(email);
      const format = emailProblem(email);
      if (format) return { ok: false, message: format, suggestion };
      const domain = await emailDomainService.problem(email);
      return { ok: !domain, message: domain, suggestion };
    }),
    notificationOutbox: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => { authService.requireAdmin(context.user); return notificationOutbox.summary(); }),
    simulatedMailbox: (_: unknown, args: { to?: string | null }, context: ResolverContext) => safe(async () => { authService.requireAdmin(context.user); return mailService.simulatedMailbox(z.string().max(120).optional().parse(args.to ?? undefined)); }),
    taxonomy: (_: unknown, __: unknown, context: ResolverContext) => safe(() => {
      authService.requirePermission(context.user, "catalog.read");
      return productService.taxonomy();
    }),
    storeSettings: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => {
      authService.requireAdmin(context.user);
      const settings = await commerceSettingsService.get();
      return {
        persistence: productService.persistenceMode,
        freeShippingThreshold: settings.freeShippingThreshold,
        freeShippingMethods: settings.freeShippingMethods,
        shippingRates: Object.entries(settings.shippingFees).map(([method, fee]) => ({ method, fee })),
        paymentMethods: ["BANK_TRANSFER", ...(settings.cashOnDelivery.enabled ? ["CASH_ON_DELIVERY"] : [])],
        notifications: {
          email: {
            enabled: mailService.enabled,
            operator: env.mailOperator,
            bankDetailsReady: Boolean(settings.bank.name && settings.bank.accountNumber)
          },
          telegram: { enabled: telegramService.enabled }
        }
      };
    })
  },
  Mutation: {
    saveExpense: (_: unknown, args: { id: string; input: unknown; revision?: number | null }, context: ResolverContext) => safe(async () => { const actor = authService.requirePermission(context.user, "expenses.write"); return expenseService.save(args.id, args.input, args.revision ?? undefined, actor); }),
    voidExpense: (_: unknown, args: { id: string; revision: number; reason: string }, context: ResolverContext) => safe(async () => { const actor = authService.requireAdmin(context.user); return expenseService.void(args.id, args.revision, args.reason, actor); }),
    saveSupplier: (_: unknown, args: { id?: string; input: unknown }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "purchases.write"); return supplyService.saveSupplier(args.id, args.input); }),
    saveWarehouse: (_: unknown, args: { id?: string; input: unknown }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "inventory.write"); return supplyService.saveWarehouse(args.id, args.input); }),
    savePurchase: (_: unknown, args: { id?: string; input: unknown; revision?: number; idempotencyKey?: string | null }, context: ResolverContext) => safe(async () => { const actor = authService.requirePermission(context.user, "purchases.write"); return supplyService.savePurchase(args.id, args.input, args.revision, { key: args.idempotencyKey ?? undefined, actorId: actor.id }); }),
    receivePurchase: (_: unknown, args: { id: string; revision: number; input: unknown }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "purchases.write"); return supplyService.receive(idArgs.parse({ id: args.id }).id, z.number().int().nonnegative().parse(args.revision), args.input as never); }),
    changePurchase: (_: unknown, args: { id: string; status: string; revision: number; receivedOn?: string | null }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "purchases.write"); return supplyService.changePurchase(args.id, z.enum(["ORDERED", "RECEIVED", "CANCELLED"]).parse(args.status), z.number().int().nonnegative().parse(args.revision), z.string().max(10).optional().parse(args.receivedOn ?? undefined)); }),
    transferStock: (_: unknown, args: { input: unknown }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "inventory.write"); return supplyService.transfer(args.input); }),
    logout: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => authService.endSession(authService.requireUser(context.user))),
    revokeSessions: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => authService.revokeSessions(authService.requireUser(context.user))),
    requestPasswordReset: (_: unknown, args: { email: string }, context: ResolverContext) => safe(async () => { operationLimiter.consume("passwordReset", clientKey(context.ip)); return authService.requestReset(args.email); }),
    resetPassword: (_: unknown, args: { token: string; password: string }, context: ResolverContext) => safe(async () => { operationLimiter.consume("passwordReset", clientKey(context.ip)); return authService.resetPassword(args.token, args.password); }),
    importProducts: (_: unknown, args: { payloads: unknown; dryRun: boolean }, context: ResolverContext) => safe(async () => {
      authService.requirePermission(context.user, "catalog.write");
      const rows = z.array(z.unknown()).min(1).max(200).parse(args.payloads);
      const issues: Array<{ row: number; message: string }> = [];
      const payloads: Array<ReturnType<typeof productPayloadSchema.parse>> = [];
      const seen = new Set<string>();
      for (const [i, row] of rows.entries()) { const result = productPayloadSchema.safeParse(row); if (!result.success) { issues.push({ row: i + 2, message: result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ") }); continue; } if (seen.has(result.data.slug) || await productService.slugExists(result.data.slug)) issues.push({ row: i + 2, message: "El identificador del producto ya existe o está repetido en el archivo" }); if (context.user?.role === "CATALOG" && result.data.variants.some(v => v.stock > 0)) issues.push({row:i+2,message:"El perfil Catálogo crea productos con stock cero. El ingreso se registra en Inventario."}); seen.add(result.data.slug); payloads.push(result.data); }
      if (issues.length || args.dryRun) return { valid: !issues.length, issues, count: rows.length, created: 0 };
      for (const payload of payloads) await saveProductSafely(undefined, payload, undefined, context.user);
      return { valid: true, issues: [], count: rows.length, created: payloads.length };
    }),
    generateExchange: (_: unknown, args: { input: unknown; idempotencyKey: string }, context: ResolverContext) => safe(async () => { const actor = authService.requirePermission(context.user, "purchases.write"); return exchangeService.generate(args.input, args.idempotencyKey, { id: actor.id, name: actor.name }); }),
    linkExchangeReplacement: (_: unknown, args: { id: string; revision: number; purchaseId: string }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "purchases.write"); return exchangeService.linkReplacement(idArgs.parse({ id: args.id }).id, z.number().int().nonnegative().parse(args.revision), idArgs.parse({ id: args.purchaseId }).id); }),
    closeExchange: (_: unknown, args: { id: string; revision: number; note: string }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "purchases.write"); return exchangeService.close(idArgs.parse({ id: args.id }).id, z.number().int().nonnegative().parse(args.revision), args.note); }),
    voidExchange: (_: unknown, args: { id: string; revision: number; reason: string }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "purchases.write"); return exchangeService.void(idArgs.parse({ id: args.id }).id, z.number().int().nonnegative().parse(args.revision), args.reason); }),
    approvePurchaseImport: (_: unknown, args: { id: string; revision: number; input: unknown }, context: ResolverContext) => safe(async () => { const actor = authService.requirePermission(context.user, "purchases.write"); return purchaseImportService.approve(idArgs.parse({ id: args.id }).id, z.number().int().nonnegative().parse(args.revision), args.input, { id: actor.id, name: actor.name }); }),
    discardPurchaseImport: (_: unknown, args: { id: string; revision: number; reason: string }, context: ResolverContext) => safe(async () => { const actor = authService.requirePermission(context.user, "purchases.write"); return purchaseImportService.discard(idArgs.parse({ id: args.id }).id, z.number().int().nonnegative().parse(args.revision), args.reason, { id: actor.id, name: actor.name }); }),
    adjustStock: (_: unknown, args: { input: unknown }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "inventory.write"); return productService.adjustStock(args.input); }),
    saveAccount: (_: unknown, args: { id?: string; input: unknown }, context: ResolverContext) => safe(async () => {
      const actor = authService.requireAdmin(context.user);
      const before = args.id ? await authService.findUser(args.id) : null;
      const saved = await authService.saveAccount(actor, args.id, args.input);
      securityAlerts.staffAccess(actor, before, saved);
      return saved;
    }),
    editOrderDetails: (_: unknown, args: { id: string; input: unknown }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "orders.write"); return orderService.editDetails(args.id, args.input); }),
    renameMedia: (_: unknown, args: { id: string; label: string }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "catalog.write"); return mediaService.rename(args.id, z.string().trim().max(140).parse(args.label)); }),
    deleteMedia: (_: unknown, args: { id: string }, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "catalog.write"); return mediaService.remove(args.id); }),
    // C49: mueve inventario y pedidos entre fichas: solo Administración.
    mergeProducts: (_: unknown, args: { input: unknown }, context: ResolverContext) => safe(async () => {
      authService.requireAdmin(context.user);
      const result = await mergeProducts(args.input);
      return { ...result, product: redact(result.product) };
    }),
    // C44: el cliente enlaza pedidos que hizo sin sesión. El servicio exige número
    // y correo de la cuenta; el límite es el mismo que el de la consulta de pedidos.
    updateMyContact: (_: unknown, args: { input: unknown; revision: number }, context: ResolverContext) => safe(() => customerProfileService.updateContact(context.user, args.input, args.revision)),
    updateMyBilling: (_: unknown, args: { input?: unknown; revision: number }, context: ResolverContext) => safe(() => customerProfileService.updateBilling(context.user, args.input ?? null, args.revision)),
    addMyAddress: (_: unknown, args: { input: unknown; revision: number; makeDefault?: boolean | null }, context: ResolverContext) => safe(() => customerProfileService.addAddress(context.user, args.input, args.revision, Boolean(args.makeDefault))),
    updateMyAddress: (_: unknown, args: { id: string; input: unknown; revision: number }, context: ResolverContext) => safe(() => customerProfileService.updateAddress(context.user, args.id, args.input, args.revision)),
    // `nextDefaultId` ausente y `null` significan cosas distintas (plan §5.1): se respeta la diferencia.
    removeMyAddress: (_: unknown, args: { id: string; revision: number; nextDefaultId?: string | null }, context: ResolverContext) => safe(() => customerProfileService.removeAddress(context.user, args.id, args.revision, "nextDefaultId" in args ? args.nextDefaultId : undefined)),
    setMyDefaultAddress: (_: unknown, args: { id: string; revision: number }, context: ResolverContext) => safe(() => customerProfileService.setDefaultAddress(context.user, args.id, args.revision)),
    cancelMyOrder: (_: unknown, args: { number: string }, context: ResolverContext) => safe(async () => {
      const user = authService.requireCustomer(context.user);
      operationLimiter.consume("orderCancel", user.id);
      const result = await orderService.cancelByCustomer(user, args.number);
      return { ...result, order: customerOrderView(result.order as Parameters<typeof customerOrderView>[0], result.accountBlocked ? 0 : await authService.customerCancellations(user.id)) };
    }),
    requestOrderCancellation: (_: unknown, args: { number: string; reason: string; note?: string | null }, context: ResolverContext) => safe(async () => {
      const user = authService.requireCustomer(context.user);
      operationLimiter.consume("orderCancel", user.id);
      const request = await cancellationRequestService.request(user, args.number, { reason: args.reason, note: args.note ?? "" });
      const order = await orderService.findOwned(user.id, args.number);
      return customerOrderView(order as Parameters<typeof customerOrderView>[0], await authService.customerCancellations(user.id), request);
    }),
    resolveCancellationRequest: (_: unknown, args: { id: string; revision: number; approve: boolean; publicNote: string; internalNote?: string | null }, context: ResolverContext) => safe(async () => {
      const actor = authService.requirePermission(context.user, "orders.write");
      const decided = await cancellationRequestService.resolve(actor, args.id, { revision: args.revision, approve: args.approve, publicNote: args.publicNote, internalNote: args.internalNote ?? "" });
      return (await cancellationRequestService.list("ALL")).find(request => request.id === decided.id)!;
    }),
    linkGuestOrders: (_: unknown, args: { orderNumbers: unknown }, context: ResolverContext) => safe(async () => {
      const user = authService.requireUser(context.user);
      if (user.role !== "CUSTOMER") throw new GraphQLError("Solo las cuentas de cliente agregan pedidos.", { extensions: { code: "FORBIDDEN" } });
      // D10/CU04: coincidir en el correo solo acredita propiedad si ese correo está confirmado.
      if (!user.emailVerified) throw new GraphQLError("Confirma tu correo para agregar a tu cuenta los pedidos que hiciste sin ella.", { extensions: { code: "FORBIDDEN" } });
      operationLimiter.consume("orderLookup", clientKey(context.ip));
      const orderNumbers = await orderService.linkGuestOrders(user, args.orderNumbers);
      return { linked: orderNumbers.length, orderNumbers };
    }),
    startTwoFactorSetup: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => authService.startTwoFactor(context.user)),
    confirmTwoFactorSetup: (_: unknown, args: { code: string }, context: ResolverContext) => safe(async () => {
      operationLimiter.consume("twoFactor", authService.requireUser(context.user).id);
      const result = await authService.confirmTwoFactor(context.user, z.string().trim().max(20).parse(args.code));
      securityAlerts.twoFactorChanged(context.user!, true);
      return result;
    }),
    disableTwoFactor: (_: unknown, args: { code: string }, context: ResolverContext) => safe(async () => {
      operationLimiter.consume("twoFactor", authService.requireUser(context.user).id);
      const result = await authService.disableTwoFactor(context.user, z.string().trim().max(20).parse(args.code));
      if (context.user!.twoFactorEnabled) securityAlerts.twoFactorChanged(context.user!, false);
      return result;
    }),
    resetTwoFactor: (_: unknown, args: { id: string }, context: ResolverContext) => safe(async () => {
      const target = await authService.findUser(idArgs.parse(args).id);
      const done = await authService.resetTwoFactor(context.user, idArgs.parse(args).id);
      if (target) securityAlerts.twoFactorReset(context.user!, target);
      return done;
    }),
    register: (_: unknown, args: { input: unknown }, context: ResolverContext) => safe(async () => {
      operationLimiter.consume("register", clientKey(context.ip));
      if (!customerAccountsEnabled()) throw new GraphQLError(accountsOffMessage, { extensions: { code: "FORBIDDEN" } });
      const { captchaToken, ...input } = (args.input ?? {}) as { captchaToken?: string | null };
      await verifyHuman(captchaToken, context.ip);
      return authService.register(input);
    }),
    verifyEmail: (_: unknown, args: { token: string }, context: ResolverContext) => safe(async () => { operationLimiter.consume("emailVerification", clientKey(context.ip)); return authService.verifyEmail(args.token); }),
    resendVerification: (_: unknown, args: { email: string }, context: ResolverContext) => safe(async () => { operationLimiter.consume("emailVerification", clientKey(context.ip)); return authService.resendVerification(args.email); }),
    requestEmailChange: (_: unknown, args: { email: string; password: string }, context: ResolverContext) => safe(async () => {
      operationLimiter.consume("emailChange", authService.requireCustomer(context.user).id);
      return authService.requestEmailChange(context.user, args.email, args.password);
    }),
    confirmEmailChange: (_: unknown, args: { token: string }, context: ResolverContext) => safe(async () => { operationLimiter.consume("emailVerification", clientKey(context.ip)); return authService.confirmEmailChange(args.token); }),
    login: (_: unknown, args: { input: unknown }, context: ResolverContext) => safe(async () => {
      const connection = clientKey(context.ip);
      operationLimiter.consume("login", connection);
      // Fallos por cuenta y conexión (C60, S03): una conexión que falla mucho queda fuera
      // para esa cuenta; los fallos repartidos entre muchas conexiones solo cierran la
      // cuenta a conexiones nuevas, así un tercero no deja fuera a quien ya entró antes.
      const rawEmail = (args.input as { email?: unknown } | null)?.email;
      const account = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase().slice(0, 120) : "";
      const pair = `${account}|${connection}`;
      if (account) {
        operationLimiter.assert("loginFailuresPair", pair);
        if (!trustedLogins.has(account, connection)) operationLimiter.assert("loginFailures", account);
      }
      try {
        const payload = await authService.login(args.input);
        if (account) { operationLimiter.reset("loginFailuresPair", pair); trustedLogins.remember(account, connection); }
        return payload;
      } catch (error) {
        if (account && error instanceof GraphQLError && error.extensions?.code === "UNAUTHENTICATED") {
          operationLimiter.hit("loginFailuresPair", pair);
          operationLimiter.hit("loginFailures", account);
          securityAlerts.loginFailed(account, context.ip ?? "");
        }
        throw error;
      }
    }),
    createCheckoutOrder: (_: unknown, args: { input: unknown }, context: ResolverContext) => safe(async () => {
      operationLimiter.consume("checkout", clientKey(context.ip));
      // El token no forma parte de la solicitud (no cambia su huella) y solo se verifica para un pedido
      // nuevo: un reintento de la misma solicitud devuelve el pedido ya registrado (C70).
      const { captchaToken, ...input } = (args.input ?? {}) as { captchaToken?: string | null; expectedTotal?: number | null };
      // D12: clientes e invitados confirman el total que vieron; si cambió, el servicio rechaza el
      // pedido sin reservar. El panel no muestra un total antes de crear el pedido.
      if (!isStaff(context) && typeof input.expectedTotal !== "number") throw new GraphQLError("Actualiza el total del carrito antes de confirmar el pedido.", { extensions: { code: "BAD_USER_INPUT" } });
      return orderService.create(input, context.user, { beforeNew: () => verifyHuman(captchaToken, context.ip) });
    }),
    recordOrderReturn: (_: unknown, args: {id: string; input: unknown}, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "orders.write"); return orderService.recordReturn(args.id, args.input); }),
    recordOrderRefund: (_: unknown, args: {id: string; input: unknown}, context: ResolverContext) => safe(async () => { authService.requirePermission(context.user, "orders.write"); return orderService.recordRefund(args.id, args.input); }),
    confirmCashOnDeliveryOrder: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(() => {
      authService.requirePermission(context.user, "orders.write");
      const args = z.object({ id: z.string().min(1), location: z.string().optional() }).parse(rawArgs);
      return orderService.confirmCashOnDelivery(args.id, { location: args.location ?? "" });
    }),
    updateOrderStatus: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(() => {
      authService.requirePermission(context.user, "orders.write");
      const args = orderStatusArgs.parse(rawArgs);
      return orderService.updateStatus(args.id, args.status);
    }),
    upsertProduct: (_: unknown, args: { id?: string; payload: unknown; expectedStocks?: unknown; expectedRevision?: number }, context: ResolverContext) => safe(() => {
      authService.requirePermission(context.user, "catalog.write");
      return saveProductSafely(args.id, args.payload, args.expectedStocks, context.user, args.expectedRevision);
    }),
    createProduct: (_: unknown, args: { payload: unknown; expectedStocks?: unknown; expectedRevision?: number }, context: ResolverContext) => safe(() => {
      authService.requirePermission(context.user, "catalog.write");
      return saveProductSafely(undefined, args.payload, undefined, context.user);
    }),
    updateProduct: (_: unknown, args: { id: string; payload: unknown; expectedStocks?: unknown; expectedRevision?: number }, context: ResolverContext) => safe(() => {
      authService.requirePermission(context.user, "catalog.write");
      return saveProductSafely(args.id, args.payload, args.expectedStocks, context.user, args.expectedRevision);
    }),
    deleteProduct: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(() => {
      authService.requirePermission(context.user, "catalog.write");
      const args = idArgs.parse(rawArgs);
      return productService.archive(args.id);
    }),
    restoreProduct: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(() => {
      authService.requirePermission(context.user, "catalog.write");
      const args = idArgs.parse(rawArgs);
      return productService.restore(args.id);
    }),
    updateUserStatus: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(() => {
      const actor = authService.requireAdmin(context.user);
      const args = userStatusArgs.parse(rawArgs);
      return authService.setUserStatus(actor, args.id, args.status);
    }),
    updateUserRole: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(async () => {
      const actor = authService.requireAdmin(context.user);
      const args = userRoleArgs.parse(rawArgs);
      const before = await authService.findUser(args.id);
      const saved = await authService.setUserRole(actor, args.id, args.role);
      securityAlerts.staffAccess(actor, before, saved);
      return saved;
    }),
    // Cambiar la cuenta de cobro es sensible: solo Administración, auditado y con aviso al operador.
    // Solo los marca pendientes: el despachador periódico los envía fuera de esta petición.
    retryFailedNotifications: (_: unknown, __: unknown, context: ResolverContext) => safe(async () => { authService.requireAdmin(context.user); return notificationOutbox.retryFailed(); }),
    saveCommerceSettings: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(async () => {
      const actor = authService.requireAdmin(context.user);
      const args = z.object({ input: z.unknown(), revision: z.number().int().nonnegative() }).parse(rawArgs);
      // El aviso se guarda en la misma transacción que la cuenta nueva: no puede cambiarse sin que el operador se entere.
      const { settings } = await unitOfWork(async () => {
        const saved = await commerceSettingsService.save(args.input, args.revision, { name: actor.name });
        if (saved.bankChanged) await notificationOutbox.enqueue([{ kind: "OPERATOR_NOTICE", label: "aviso de cambio de cuenta bancaria", text: `Cuenta bancaria de la tienda cambiada por ${actor.name} (${actor.email}): ${saved.settings.bank.name}, ${saved.settings.bank.accountType}, ${saved.settings.bank.accountNumber}, ${saved.settings.bank.holder}. Si no fuiste tú, revisa el panel de inmediato.` }]);
        return saved;
      });
      return settings;
    }),
    saveCampaign: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(async () => {
      const actor = authService.requirePermission(context.user, "catalog.write");
      const args = z.object({ id: z.string().uuid(), input: z.unknown(), revision: z.number().int().nonnegative().optional().nullable() }).parse(rawArgs);
      return campaignService.save(args.id, args.input, args.revision ?? undefined, { id: actor.id, name: actor.name });
    }),
    deleteCampaign: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(async () => {
      authService.requirePermission(context.user, "catalog.write");
      const args = z.object({ id: z.string().uuid(), revision: z.number().int().nonnegative() }).parse(rawArgs);
      return campaignService.remove(args.id, args.revision);
    }),
    setProductFeatured: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(async () => {
      authService.requirePermission(context.user, "catalog.write");
      const args = z.object({ id: z.string().min(1).max(80), featured: z.boolean(), revision: z.number().int().nonnegative() }).parse(rawArgs);
      return productService.setFeatured(args.id, args.featured, args.revision);
    }),
    editTaxonomy: (_: unknown, rawArgs: unknown, context: ResolverContext) => safe(() => {
      authService.requirePermission(context.user, "catalog.write");
      const args = taxonomyArgs.parse(rawArgs);
      return productService.editTaxonomy(args.kind, args.action, args.key, args.target ?? "");
    })
  }
};

async function saveProductSafely(id: string | undefined, payload: unknown, expectedStocks: unknown, actor?: {role:string} | null, expectedRevision?: number) {
  const parsed = productPayloadSchema.parse(payload);
  if (actor?.role === "CATALOG") { const prior = id ? await productService.get(id) : null; if(parsed.variants.some(v=>v.stock !== (prior?.variants.find(p=>p.sku===v.sku)?.stock ?? 0))) throw new Error("El perfil Catálogo no puede modificar existencias. Solicita el ingreso a Inventario."); }
  const expected = parseExpectedStocks(id, expectedStocks);
  if (id) {
    const skus = z.object({ variants: z.array(z.object({ sku: z.string() })) }).parse(payload).variants.map((v) => v.sku);
    const current = await productService.get(id);
    const removed = current?.variants.filter((v) => !skus.includes(v.sku)).map((v) => v.sku) ?? [];
    await orderService.assertVariantsUnused(id, removed);
    await supplyService.assertVariantsUnused(id, removed);
  }
  const revision = id ? z.number().int().nonnegative().parse(expectedRevision) : undefined;
  return productService.upsert(id, payload, expected, revision);
}

function parseExpectedStocks(id: string | undefined, value: unknown) {
  if (!id) return undefined;
  return z.array(z.object({ sku: z.string(), stock: z.number().int().nonnegative() })).max(120).parse(value);
}
const customerProfileMutations = new Set(["updateMyContact", "updateMyBilling", "addMyAddress", "updateMyAddress", "removeMyAddress", "setMyDefaultAddress"]);
// Every mutation goes through the same journal, including authentication and failed authorization.
const auditedMutations = Object.fromEntries(Object.entries(baseResolvers.Mutation).map(([action, resolver]) => [action, async (parent: unknown, args: Record<string, unknown>, context: ResolverContext) => {
  const entity = /Commerce/.test(action) ? "settings" : /Campaign/.test(action) ? "campaigns" : /Expense/.test(action) ? "expenses" : /Supplier/.test(action) ? "suppliers" : /Warehouse/.test(action) ? "warehouses" : /Exchange/.test(action) ? "exchanges" : /Purchase/.test(action) ? "purchases" : /Product|Taxonomy|Stock/.test(action) ? "products" : /Order/.test(action) ? "orders" : /Media/.test(action) ? "media" : "users";
  const id = String(args.id ?? (args.input as { productId?: string } | undefined)?.productId ?? "");
  const requestedSlugs = new Set(Array.isArray(args.payloads) ? args.payloads.flatMap(row => row && typeof row.slug === "string" ? [row.slug as string] : []) : []);
  let affectedIds: string[] = [];
  const snapshot = async (result?: unknown): Promise<unknown> => {
    const resultRecord = result as {id?: unknown; _id?: unknown} | null;
    const recordId = id || String(resultRecord?.id ?? resultRecord?._id ?? "");
    // A guest checkout may snapshot its own newly-created order, never an
    // arbitrary order supplied by an unauthenticated caller.
    if (action === "createCheckoutOrder" && result !== undefined && recordId) return redact(await orderService.get(recordId));
    if (!context.user || context.user.role === "CUSTOMER") return null;
    if (entity === "expenses") return permissions[context.user.role].includes("expenses.write") && recordId ? expenseService.get(recordId) : null;
    if (entity === "campaigns") return recordId ? campaignService.get(recordId) : null;
    if (entity === "settings") return commerceSettingsService.get();
    if (entity === "products") {
      if (action === "editTaxonomy" || action === "importProducts") {
        const rows = await productService.allForManagement();
        if (result === undefined) {
          affectedIds = rows.filter(p => action === "importProducts"
            ? requestedSlugs.has(p.slug)
            : args.kind === "BRAND" ? p.brand === args.key : (args.kind === "CATEGORY" ? p.categories : p.goals).some(ref => ref.slug === args.key)).map(productId);
        }
        const selected = rows.filter(p => affectedIds.includes(productId(p)) || action === "importProducts" && requestedSlugs.has(p.slug));
        return { records: selected.map(p => action === "editTaxonomy" ? {id: productId(p), brand:p.brand, categories:p.categories, goals:p.goals} : {...p, id:productId(p)}).sort((a,b) => a.id.localeCompare(b.id)) };
      }
      return recordId ? redact(await productService.get(recordId)) : null;
    }
    if (entity === "orders") return recordId ? redact(await orderService.get(recordId)) : null;
    if (entity === "purchases") return (await supplyService.purchases()).find(p => p.id === recordId) ?? null;
    if (entity === "exchanges") return recordId ? exchangeService.get(recordId) : null;
    if (entity === "suppliers") return (await supplyService.suppliers()).find(p => p.id === recordId) ?? null;
    if (entity === "warehouses") return (await supplyService.warehouses()).find(p => p.id === recordId) ?? null;
    if (entity === "users" && context.user.role === "ADMIN" && recordId) return redact(await authService.findUser(recordId));
    return null;
  };
  const work = () => (resolver as (p: unknown, a: unknown, c: ResolverContext) => Promise<unknown>)(parent, args, context);
  const transactional = /Commerce|Campaign|Expense|Product|Taxonomy|Stock|Order|Purchase|Supplier|Warehouse|Exchange/.test(action);
  const hasSnapshot = transactional || entity === "users" && Boolean(id);
  // CU03: del perfil del cliente solo se anota qué se cambió, no direcciones, teléfonos ni documento.
  const auditInput = customerProfileMutations.has(action) ? { fields: Object.keys((args.input ?? {}) as object), revision: args.revision, makeDefault: args.makeDefault, nextDefault: "nextDefaultId" in args ? (args.nextDefaultId === null ? "none" : "set") : undefined } : args;
  return auditService.run(context, action, customerProfileMutations.has(action) ? "customerProfile" : entity, id, auditInput, null, work, {transactional, ...(hasSnapshot ? {snapshot} : {})});
}]));
const sensitiveQueries = new Set(["cancellationRequests", "commercialOverview", "expenses", "staffHome", "accounts", "users", "orders", "order", "databaseRecords", "auditEvents", "storeSettings", "managementDashboard", "inventoryOverview", "supplyOverview", "stockMovements", "mySessions", "adminStats"]);
const auditedQueries = Object.fromEntries(Object.entries(baseResolvers.Query).map(([action, resolver]) => [action, sensitiveQueries.has(action) ? async (parent: unknown, args: Record<string, unknown>, context: ResolverContext) => {
  let output: unknown;
  await auditService.run(context, `read:${action}`, "access", "", args, null, async () => {
    output = await (resolver as (p: unknown, a: unknown, c: ResolverContext) => Promise<unknown>)(parent, args, context);
    return { access: "READ" };
  });
  return output;
} : resolver]));
export const resolvers = { ...baseResolvers, Query: auditedQueries, Mutation: auditedMutations };
