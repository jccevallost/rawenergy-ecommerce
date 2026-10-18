export const typeDefs = `#graphql
  scalar JSON

  enum ProductType { SUPPLEMENT APPAREL }
  type TaxonomyRef { name: String! slug: String! }
  type ProductImage { url: String! alt: String! }
  type ProductSize { value: Float! unit: String! }
  type ProductVariant { id: ID flavor: String! size: ProductSize! sizeValue: Float! sizeUnit: String! price: Float! compareAtPrice: Float stock: Int! reorderPoint: Int sku: String! imageAlts: [String!]! images: [ProductImage!]! imageUrls: [String!]! }
  # Un valor nulo significa que la etiqueta no lo declara.
  type NutritionalFacts { servingSize: String! calories: Float protein: Float carbohydrates: Float fats: Float }
  type PriceRange { min: Float! max: Float! }
  type Product {
    id: ID!
    title: String!
    revision: Int!
    brand: String!
    slug: String!
    shortDescription: String!
    # Datos de la etiqueta (C66); vacío o nulo si no se cargaron.
    ingredients: String
    usage: String
    warnings: String
    productType: ProductType!
    nutritionalFacts: NutritionalFacts
    primaryImage: ProductImage
    priceRange: PriceRange!
    variants: [ProductVariant!]!
    categories: [TaxonomyRef!]!
    goals: [TaxonomyRef!]!
    # Retirados en C67: valor fijo para que la tienda y el panel publicados antes no fallen.
    vitalCoinsReward: Int! @deprecated(reason: "Sin uso en la tienda")
    maxInstallments: Int! @deprecated(reason: "Sin uso en la tienda")
    hasFreeShipping: Boolean! @deprecated(reason: "El envío gratis lo deciden las reglas del panel")
    storeBadges: [String!]! @deprecated(reason: "Sin uso en la tienda")
    featured: Boolean!
    active: Boolean!
  }
  enum ProductStatus { ACTIVE ARCHIVED ALL }
  enum ProductSort { PRICE_ASC PRICE_DESC }
  type CatalogCategory { slug: String! name: String! count: Int! }
  input ProductFiltersInput { sort: ProductSort minPrice: Float maxPrice: Float inStock: Boolean featured: Boolean search: String brands: [String!] categories: [String!] goals: [String!] flavors: [String!] status: ProductStatus }
  input CursorPaginationInput { first: Int = 12 after: String }
  type ProductEdge { cursor: String! node: Product! }
  type PageInfo { endCursor: String hasNextPage: Boolean! }
  type ProductConnection { edges: [ProductEdge!]! pageInfo: PageInfo! totalCount: Int! }
  input CartItemInput { productId: ID! variantSku: String! quantity: Int! }
  type CartTotals { subtotal: Float! discount: Float! discountCode: String discountPercent: Int discountMessage: String shippingFee: Float! total: Float! earnedCoins: Int! @deprecated(reason: "Sin uso en la tienda (C67)") freeShippingThreshold: Float! amountUntilFreeShipping: Float! hasFreeShipping: Boolean! }
  enum UserRole { CUSTOMER CATALOG WAREHOUSE MANAGER STORE_MANAGER ADMIN }
  enum UserStatus { ACTIVE BLOCKED }
  type User { id: ID! name: String! email: String! role: UserRole! status: UserStatus! createdAt: String lastLoginAt: String twoFactorEnabled: Boolean! "CU04: el cliente confirmó su correo; el personal siempre true." emailVerified: Boolean! "Solo personal: debe activar el segundo factor antes de usar el panel (SEG-01)." twoFactorRequired: Boolean! }
  type AuthPayload { token: String! user: User! }
  "CU04: misma respuesta exista o no la cuenta (D05). deliveryAvailable: hay canal de correo configurado."
  type AccountRequestResult { accepted: Boolean! deliveryAvailable: Boolean! }
  input RegisterInput { name: String! email: String! password: String! captchaToken: String }
  # code: segundo factor (C69), solo si la cuenta lo tiene activo.
  input LoginInput { email: String! password: String! code: String }
  type TwoFactorSetup { secret: String! otpauthUrl: String! }
  type TwoFactorRecovery { recoveryCodes: [String!]! }
  enum PaymentMethod { BANK_TRANSFER CASH_ON_DELIVERY }
  enum ShippingMethod { EXPRESS_QUITO_VALLES SERVIENTREGA_NATIONAL }
  enum OrderStatus { PENDING_PAYMENT PAYMENT_REVIEW PAID PREPARING SHIPPED COMPLETED CANCELLED RETURNED }
  type OrderCustomer { fullName: String! email: String! phone: String! province: String! city: String! address: String! reference: String idType: String idNumber: String }
  type OrderItem { productId: ID! variantSku: String! title: String! variantLabel: String! image: String quantity: Int! unitPrice: Float! lineTotal: Float! discount: Float }
  type OrderDiscount { code: String! percent: Int! amount: Float! }
  "CU07: quién recibe. En pedidos sin destinatario distinto es el comprador (sameAsBuyer)."
  type OrderRecipient { name: String! phone: String! sameAsBuyer: Boolean! addressLabel: String }
  "CU07: a nombre de quién se factura. Sin factura distinta es el comprador (sameAsBuyer)."
  type OrderInvoice { name: String! idType: String idNumber: String email: String! sameAsBuyer: Boolean! }
  type Order {
    id: ID!
    orderNumber: String!
    customer: OrderCustomer!
    recipient: OrderRecipient!
    invoice: OrderInvoice!
    items: [OrderItem!]!
    shippingMethod: ShippingMethod!
    paymentMethod: PaymentMethod!
    status: OrderStatus!
    allowedNextStatuses: [OrderStatus!]!
    paidAt: String
    "Contra entrega confirmada por WhatsApp; null si aún no."
    confirmedAt: String
    deliveryLocation: String
    operations: JSON
    subtotal: Float!
    discount: OrderDiscount
    shippingFee: Float!
    total: Float!
    notes: String
    paymentReference: String
    createdAt: String
    updatedAt: String
  }
  # CU09: proyección del cliente. Sin costos, lotes, actores ni notas internas.
  type CustomerOrderItem { variantSku: String! title: String! variantLabel: String! image: String quantity: Int! unitPrice: Float! lineTotal: Float! returnedQuantity: Int! }
  type CustomerOrderDelivery { province: String! city: String! address: String! reference: String! }
  type CustomerOrderEvent { status: OrderStatus! at: String! note: String }
  type CustomerOrderRefund { at: String! amount: Float }
  "Calculado en el servidor con la política vigente; la interfaz no decide."
  type OrderCancellation { canCancel: Boolean! canRequestCancellation: Boolean! reason: String "CU11: cancelar este pedido bloquearía la cuenta (tercera seguida)." blocksAccount: Boolean! }
  "CU12: solicitud de cancelación vista por su dueño."
  type CancellationRequestInfo { status: String! reason: String! createdAt: String! decidedAt: String publicNote: String }
  enum CancellationReason { CHANGED_MIND WRONG_PRODUCT DELAY OTHER }
  type StaffRequestOrder { status: OrderStatus! paymentMethod: PaymentMethod! total: Float! paidAt: String customerName: String! }
  type StaffCancellationRequest { id: ID! orderId: ID! orderNumber: String! status: String! reason: String! reasonLabel: String! note: String! createdAt: String! decidedAt: String publicNote: String! internalNote: String! revision: Int! order: StaffRequestOrder }
  type CustomerCancelResult { order: CustomerOrder! alreadyCancelled: Boolean! accountBlocked: Boolean! }
  type CustomerOrder {
    orderNumber: String! createdAt: String! status: OrderStatus! paymentMethod: PaymentMethod! shippingMethod: ShippingMethod!
    confirmedAt: String paidAt: String items: [CustomerOrderItem!]! subtotal: Float! discount: OrderDiscount shippingFee: Float! total: Float!
    delivery: CustomerOrderDelivery! recipient: OrderRecipient! invoice: OrderInvoice! events: [CustomerOrderEvent!]! refund: CustomerOrderRefund
    cancellation: OrderCancellation!
    cancellationRequest: CancellationRequestInfo
  }
  enum CustomerOrderFilter { ALL ACTIVE FINISHED CANCELLED }
  type CustomerOrderPage { orders: [CustomerOrder!]! hasMore: Boolean! nextCursor: String }
  input CheckoutCustomerInput { fullName: String! email: String! phone: String! province: String! city: String! address: String! reference: String idType: String idNumber: String }
  input CheckoutItemInput { productId: ID! variantSku: String! quantity: Int! }
  "CU07: dirección guardada (id y updatedAt que se vieron) y destinatario distinto. Opcional."
  input CheckoutDeliveryInput { addressId: ID addressUpdatedAt: String recipientName: String recipientPhone: String }
  input CheckoutBillingInput { name: String! idType: String idNumber: String! email: String }
  input CheckoutInput { expectedTotal: Float idempotencyKey: String! customer: CheckoutCustomerInput! items: [CheckoutItemInput!]! shippingMethod: ShippingMethod! paymentMethod: PaymentMethod = BANK_TRANSFER notes: String paymentReference: String discountCode: String captchaToken: String delivery: CheckoutDeliveryInput billing: CheckoutBillingInput }

  input OrderFiltersInput { status: OrderStatus search: String }
  type OrderConnection { orders: [Order!]! totalCount: Int! }
  type CatalogStats { active: Int! archived: Int! featured: Int! stock: Int! }
  type AccountStats { customers: Int! admins: Int! blocked: Int! }
  type OrderStats { total: Int! pendingPayment: Int! revenue: Float! }
  type AdminStats { catalog: CatalogStats! accounts: AccountStats! orders: OrderStats! }
  enum TaxonomyKind { CATEGORY GOAL BRAND }
  enum TaxonomyAction { RENAME MERGE REMOVE }
  type TaxonomyEntry { key: String! name: String! productCount: Int! }
  type TaxonomyOverview { categories: [TaxonomyEntry!]! goals: [TaxonomyEntry!]! brands: [TaxonomyEntry!]! }
  type ShippingRate { method: ShippingMethod! fee: Float! }
  type MailSettings { enabled: Boolean! operator: String! bankDetailsReady: Boolean! }
  type TelegramSettings { enabled: Boolean! }
  type NotificationSettings { email: MailSettings! telegram: TelegramSettings! }
  type BankInstructions { name: String! accountType: String! accountNumber: String! holder: String! }
  type CashOnDeliveryRules { enabled: Boolean! expressOnly: Boolean! minimumSubtotal: Float! confirmHours: Int! }
  # bank es null cuando la tienda da los datos de transferencia por WhatsApp.
  type CheckoutInfo { bank: BankInstructions freeShippingThreshold: Float! freeShippingMethods: [ShippingMethod!]! shippingRates: [ShippingRate!]! notifiesByEmail: Boolean! whatsapp: String reservationHours: Int! cashOnDelivery: CashOnDeliveryRules! welcomeDiscount: WelcomeOffer captchaSiteKey: String customerAccounts: Boolean! }
  "Descuento de bienvenida vigente; code es null si la tienda no lo anuncia."
  type WelcomeOffer { percent: Int! minimumSubtotal: Float! endsOn: String code: String }
  type EmailCheck { ok: Boolean! message: String suggestion: String }
  type StoreSettings {
    persistence: String!
    freeShippingThreshold: Float!
    # Lo pide el panel desde C31 y faltaba en el esquema: la consulta fallaba con 400 (corregido en C62).
    freeShippingMethods: [ShippingMethod!]!
    shippingRates: [ShippingRate!]!
    paymentMethods: [PaymentMethod!]!
    notifications: NotificationSettings!
  }

  enum CampaignTheme { NOCHE ORO CLARO }
  type Campaign {
    id: ID! slug: String! title: String! eyebrow: String! message: String! ctaLabel: String!
    theme: CampaignTheme! startsOn: String! endsOn: String! imageUrl: String
    products(limit: Int = 8): [Product!]!
  }

  # Consulta pública de un pedido: sin datos de contacto ni dirección.
  type TrackedItem { title: String! variantLabel: String! quantity: Int! lineTotal: Float! }
  type TrackedOrder {
    orderNumber: String! status: OrderStatus! paymentMethod: PaymentMethod! createdAt: String! reservedUntil: String awaitingConfirmation: Boolean!
    shippingMethod: ShippingMethod! subtotal: Float! discount: OrderDiscount shippingFee: Float! total: Float! items: [TrackedItem!]!
  }

  # Datos públicos para las políticas legales; los ausentes no se muestran.
  type StoreLegal { storeName: String! legalName: String ruc: String address: String email: String whatsapp: String reservationHours: Int! }

  type Query {
    commercialOverview: JSON!
    expenses(filters: JSON!): JSON!
    staffHome: JSON!
    supplyOverview: JSON!
    "ROT-01: antigüedad por recepción, productos con poca salida y umbrales vigentes."
    inventoryAging: JSON!
    "CMB-01: cambios con proveedores y saldo pendiente de reposición."
    supplierExchanges(status: String): JSON!
    "RES-01: margen bruto realizado por orden de compra, con unidades vendidas, devueltas, cambiadas y remanentes."
    purchaseResults: JSON!
    "IMP-01: facturas importadas desde PDF, más recientes primero."
    purchaseImports(limit: Int = 20): JSON!
    purchaseImport(id: ID!): JSON
    stockMovements(filters: JSON): JSON!
    mySessions: JSON!
    inventoryOverview(filters: JSON!): JSON!
    managementDashboard(filters: JSON!): JSON!
    auditEvents(filters: JSON): JSON!
    accounts(filters: JSON): JSON!
    databaseRecords(entity: String!, filters: JSON): JSON!
    me: User
    users(role: UserRole): [User!]!
    adminStats: AdminStats!
    storeSettings: StoreSettings!
    product(id: ID!): Product
    productBySlug(slug: String!): Product
    activeCampaigns: [Campaign!]!
    trackOrder(orderNumber: String!, contact: String!): TrackedOrder
    storeLegal: StoreLegal!
    commerceSettings: JSON!
    notificationOutbox: JSON!
    "CU02: buzón de prueba con MAIL_MODE=simulated; solo administración."
    simulatedMailbox(to: String): JSON!
    campaign(slug: String!): Campaign
    adminCampaigns: JSON!
    getProductsByGoal(goalSlug: String!, limit: Int = 8): [Product!]!
    searchProducts(filters: ProductFiltersInput, pagination: CursorPaginationInput): ProductConnection!
    calculateCartTotals(cartItems: [CartItemInput!]!, shippingMethod: ShippingMethod, discountCode: String): CartTotals!
    order(id: ID!): Order
    orders(filters: OrderFiltersInput, limit: Int = 40, offset: Int = 0): OrderConnection!
    myOrders(limit: Int = 20): [Order!]!
    myProfile: CustomerProfile!
    "CU09: pedidos del cliente con cursor; first entre 1 y 20."
    myOrdersPage(first: Int = 10, after: String, filter: CustomerOrderFilter = ALL): CustomerOrderPage!
    "CU12: solicitudes de cancelación; solo personal con orders.write."
    cancellationRequests(status: String = "PENDING"): [StaffCancellationRequest!]!
    "CU09: un pedido propio por número; null si no es de la cuenta."
    myOrder(number: String!): CustomerOrder
    taxonomy: TaxonomyOverview!
    catalogBrands: [String!]!
    # Tipos de producto con productos activos (C65).
    catalogCategories: [CatalogCategory!]!
    checkoutInfo: CheckoutInfo!
    "Formato, errores de tipeo comunes y que el dominio reciba correo."
    checkEmail(email: String!): EmailCheck!
    health: String!
  }
  type LinkedOrders { linked: Int! orderNumbers: [String!]! }
  # CU03: perfil y libreta de direcciones del cliente. Revisión optimista en cada escritura.
  type CustomerAddress { id: ID! label: String! province: String! city: String! address: String! reference: String! recipientName: String! recipientPhone: String! isDefault: Boolean! createdAt: String! updatedAt: String! }
  type CustomerBilling { name: String! idType: String! idNumber: String! email: String! }
  type CustomerProfile { name: String! email: String! phone: String! altPhone: String! billing: CustomerBilling addresses: [CustomerAddress!]! defaultAddressId: ID revision: Int! maxAddresses: Int! complete: Boolean! missing: [String!]! "La cuenta aún no compró: se le puede ofrecer el código de bienvenida." firstPurchase: Boolean! }
  type CustomerAddressResult { profile: CustomerProfile! addressId: ID! duplicate: Boolean! madeDefault: Boolean! }
  input CustomerContactInput { name: String! phone: String altPhone: String }
  input CustomerBillingInput { name: String! idType: String idNumber: String! email: String }
  input CustomerAddressInput { label: String! province: String! city: String! address: String! reference: String recipientName: String recipientPhone: String }

  type Mutation {
    saveExpense(id: ID!, input: JSON!, revision: Int): JSON!
    voidExpense(id: ID!, revision: Int!, reason: String!): JSON!
    saveSupplier(id: ID, input: JSON!): JSON!
    saveWarehouse(id: ID, input: JSON!): JSON!
    savePurchase(id: ID, input: JSON!, revision: Int, idempotencyKey: String): JSON!
    changePurchase(id: ID!, status: String!, revision: Int!, receivedOn: String): JSON!
    "M15: recepción total o parcial por línea; closeRemaining cierra lo que no llegó como faltante."
    receivePurchase(id: ID!, revision: Int!, input: JSON!): JSON!
    transferStock(input: JSON!): JSON!
    logout: Boolean!
    revokeSessions: Boolean!
    requestPasswordReset(email: String!): JSON!
    resetPassword(token: String!, password: String!): Boolean!
    importProducts(payloads: JSON!, dryRun: Boolean!): JSON!
    adjustStock(input: JSON!): JSON!
    "IMP-01: crea la compra en borrador con la factura importada; no toca el stock."
    approvePurchaseImport(id: ID!, revision: Int!, input: JSON!): JSON!
    discardPurchaseImport(id: ID!, revision: Int!, reason: String!): JSON!
    "CMB-01: genera el cambio y descuenta en ese momento las unidades enviadas al proveedor."
    generateExchange(input: JSON!, idempotencyKey: String!): JSON!
    linkExchangeReplacement(id: ID!, revision: Int!, purchaseId: ID!): JSON!
    closeExchange(id: ID!, revision: Int!, note: String!): JSON!
    voidExchange(id: ID!, revision: Int!, reason: String!): JSON!
    saveAccount(id: ID, input: JSON!): User!
    editOrderDetails(id: ID!, input: JSON!): Order!
    renameMedia(id: ID!, label: String!): JSON!
    deleteMedia(id: ID!): Boolean!
    "CU04: no inicia sesión; la cuenta se activa al confirmar el correo."
    register(input: RegisterInput!): AccountRequestResult!
    verifyEmail(token: String!): Boolean!
    resendVerification(email: String!): AccountRequestResult!
    "Cambio de correo con la contraseña actual; el correo vigente sigue hasta confirmar el nuevo."
    requestEmailChange(email: String!, password: String!): AccountRequestResult!
    confirmEmailChange(token: String!): Boolean!
    login(input: LoginInput!): AuthPayload!
    # Segundo factor del personal (C69).
    startTwoFactorSetup: TwoFactorSetup!
    confirmTwoFactorSetup(code: String!): TwoFactorRecovery!
    disableTwoFactor(code: String!): Boolean!
    resetTwoFactor(id: ID!): Boolean!
    createCheckoutOrder(input: CheckoutInput!): Order!
    linkGuestOrders(orderNumbers: [String!]!): LinkedOrders!
    updateMyContact(input: CustomerContactInput!, revision: Int!): CustomerProfile!
    "billing null: usar el nombre y documento del titular."
    updateMyBilling(input: CustomerBillingInput, revision: Int!): CustomerProfile!
    addMyAddress(input: CustomerAddressInput!, revision: Int!, makeDefault: Boolean = false): CustomerAddressResult!
    updateMyAddress(id: ID!, input: CustomerAddressInput!, revision: Int!): CustomerProfile!
    "Si es la predeterminada: nextDefaultId con otra dirección o null para ninguna."
    removeMyAddress(id: ID!, revision: Int!, nextDefaultId: ID): CustomerProfile!
    setMyDefaultAddress(id: ID!, revision: Int!): CustomerProfile!
    "CU11: cancelación directa del cliente según la política vigente."
    cancelMyOrder(number: String!): CustomerCancelResult!
    "CU12: pide al equipo cancelar un pedido que ya no se cancela directamente."
    requestOrderCancellation(number: String!, reason: CancellationReason!, note: String): CustomerOrder!
    "CU12: aprobar cancela el pedido en la misma transacción; rechazar exige motivo público."
    resolveCancellationRequest(id: ID!, revision: Int!, approve: Boolean!, publicNote: String!, internalNote: String): StaffCancellationRequest!
    "Une un producto como presentaciones de otro (C49). input: { sourceId, targetId, flavors?, sourceRevision?, targetRevision? }"
    mergeProducts(input: JSON!): JSON!
    recordOrderReturn(id: ID!, input: JSON!): Order!
    recordOrderRefund(id: ID!, input: JSON!): Order!
    updateOrderStatus(id: ID!, status: OrderStatus!): Order!
    confirmCashOnDeliveryOrder(id: ID!, location: String): Order!
    upsertProduct(id: ID, payload: JSON!, expectedStocks: JSON, expectedRevision: Int): Product!
    createProduct(payload: JSON!, expectedStocks: JSON, expectedRevision: Int): Product!
    updateProduct(id: ID!, payload: JSON!, expectedStocks: JSON, expectedRevision: Int): Product!
    deleteProduct(id: ID!): Boolean!
    setProductFeatured(id: ID!, featured: Boolean!, revision: Int!): Product!
    saveCampaign(id: ID!, input: JSON!, revision: Int): JSON!
    saveCommerceSettings(input: JSON!, revision: Int!): JSON!
    retryFailedNotifications: Int!
    deleteCampaign(id: ID!, revision: Int!): Boolean!
    restoreProduct(id: ID!): Product!
    updateUserStatus(id: ID!, status: UserStatus!): User!
    updateUserRole(id: ID!, role: UserRole!): User!
    editTaxonomy(kind: TaxonomyKind!, action: TaxonomyAction!, key: String!, target: String): Int!
  }
`;
