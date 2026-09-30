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
    productType: ProductType!
    nutritionalFacts: NutritionalFacts
    primaryImage: ProductImage
    priceRange: PriceRange!
    variants: [ProductVariant!]!
    categories: [TaxonomyRef!]!
    goals: [TaxonomyRef!]!
    vitalCoinsReward: Int!
    maxInstallments: Int!
    hasFreeShipping: Boolean!
    storeBadges: [String!]!
    featured: Boolean!
    active: Boolean!
  }
  enum ProductStatus { ACTIVE ARCHIVED ALL }
  enum ProductSort { PRICE_ASC PRICE_DESC }
  input ProductFiltersInput { sort: ProductSort minPrice: Float maxPrice: Float inStock: Boolean featured: Boolean search: String brands: [String!] goals: [String!] flavors: [String!] status: ProductStatus }
  input CursorPaginationInput { first: Int = 12 after: String }
  type ProductEdge { cursor: String! node: Product! }
  type PageInfo { endCursor: String hasNextPage: Boolean! }
  type ProductConnection { edges: [ProductEdge!]! pageInfo: PageInfo! totalCount: Int! }
  input CartItemInput { productId: ID! variantSku: String! quantity: Int! }
  type CartTotals { subtotal: Float! discount: Float! discountCode: String discountPercent: Int discountMessage: String shippingFee: Float! total: Float! earnedCoins: Int! freeShippingThreshold: Float! amountUntilFreeShipping: Float! hasFreeShipping: Boolean! }
  enum UserRole { CUSTOMER CATALOG WAREHOUSE MANAGER ADMIN }
  enum UserStatus { ACTIVE BLOCKED }
  type User { id: ID! name: String! email: String! role: UserRole! status: UserStatus! createdAt: String lastLoginAt: String }
  type AuthPayload { token: String! user: User! }
  input RegisterInput { name: String! email: String! password: String! }
  input LoginInput { email: String! password: String! }
  enum PaymentMethod { BANK_TRANSFER CASH_ON_DELIVERY }
  enum ShippingMethod { EXPRESS_QUITO_VALLES SERVIENTREGA_NATIONAL }
  enum OrderStatus { PENDING_PAYMENT PAYMENT_REVIEW PAID PREPARING SHIPPED COMPLETED CANCELLED RETURNED }
  type OrderCustomer { fullName: String! email: String! phone: String! province: String! city: String! address: String! reference: String idType: String idNumber: String }
  type OrderItem { productId: ID! variantSku: String! title: String! variantLabel: String! image: String quantity: Int! unitPrice: Float! lineTotal: Float! discount: Float }
  type OrderDiscount { code: String! percent: Int! amount: Float! }
  type Order {
    id: ID!
    orderNumber: String!
    customer: OrderCustomer!
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
  input CheckoutCustomerInput { fullName: String! email: String! phone: String! province: String! city: String! address: String! reference: String idType: String idNumber: String }
  input CheckoutItemInput { productId: ID! variantSku: String! quantity: Int! }
  input CheckoutInput { expectedTotal: Float idempotencyKey: String! customer: CheckoutCustomerInput! items: [CheckoutItemInput!]! shippingMethod: ShippingMethod! paymentMethod: PaymentMethod = BANK_TRANSFER notes: String paymentReference: String discountCode: String }

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
  type CheckoutInfo { bank: BankInstructions freeShippingThreshold: Float! freeShippingMethods: [ShippingMethod!]! shippingRates: [ShippingRate!]! notifiesByEmail: Boolean! whatsapp: String reservationHours: Int! cashOnDelivery: CashOnDeliveryRules! welcomeDiscount: WelcomeOffer }
  "Descuento de bienvenida vigente; code es null si la tienda no lo anuncia."
  type WelcomeOffer { percent: Int! minimumSubtotal: Float! endsOn: String code: String }
  type EmailCheck { ok: Boolean! message: String suggestion: String }
  type StoreSettings {
    persistence: String!
    freeShippingThreshold: Float!
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
    campaign(slug: String!): Campaign
    adminCampaigns: JSON!
    getProductsByGoal(goalSlug: String!, limit: Int = 8): [Product!]!
    searchProducts(filters: ProductFiltersInput, pagination: CursorPaginationInput): ProductConnection!
    calculateCartTotals(cartItems: [CartItemInput!]!, shippingMethod: ShippingMethod, discountCode: String): CartTotals!
    order(id: ID!): Order
    orders(filters: OrderFiltersInput, limit: Int = 40, offset: Int = 0): OrderConnection!
    myOrders(limit: Int = 20): [Order!]!
    taxonomy: TaxonomyOverview!
    catalogBrands: [String!]!
    checkoutInfo: CheckoutInfo!
    "Formato, errores de tipeo comunes y que el dominio reciba correo."
    checkEmail(email: String!): EmailCheck!
    health: String!
  }
  type LinkedOrders { linked: Int! orderNumbers: [String!]! }

  type Mutation {
    saveExpense(id: ID!, input: JSON!, revision: Int): JSON!
    voidExpense(id: ID!, revision: Int!, reason: String!): JSON!
    saveSupplier(id: ID, input: JSON!): JSON!
    saveWarehouse(id: ID, input: JSON!): JSON!
    savePurchase(id: ID, input: JSON!, revision: Int): JSON!
    changePurchase(id: ID!, status: String!, revision: Int!): JSON!
    transferStock(input: JSON!): JSON!
    logout: Boolean!
    revokeSessions: Boolean!
    requestPasswordReset(email: String!): JSON!
    resetPassword(token: String!, password: String!): Boolean!
    importProducts(payloads: JSON!, dryRun: Boolean!): JSON!
    adjustStock(input: JSON!): JSON!
    saveAccount(id: ID, input: JSON!): User!
    editOrderDetails(id: ID!, input: JSON!): Order!
    renameMedia(id: ID!, label: String!): JSON!
    deleteMedia(id: ID!): Boolean!
    register(input: RegisterInput!): AuthPayload!
    login(input: LoginInput!): AuthPayload!
    createCheckoutOrder(input: CheckoutInput!): Order!
    linkGuestOrders(orderNumbers: [String!]!): LinkedOrders!
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
