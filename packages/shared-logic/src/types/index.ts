export type MoneyRange = { min: number; max: number };
export type TaxonomyRef = { name: string; slug: string };
export type ProductImage = { url: string; alt: string };

export type ProductSize = { value: number; unit: string };

/**
 * Lo que devuelve la API. `size` e `images` son opcionales porque el esquema los
 * expone anidados y el limite de profundidad impide pedirlos: llegan planos como
 * `sizeValue`, `sizeUnit` e `imageUrls`. `normalizeProduct` rellena `size`.
 */
export type ProductVariant = {
  id?: string;
  flavor: string;
  size?: ProductSize;
  sizeValue?: number;
  sizeUnit?: string;
  price: number;
  compareAtPrice?: number | null;
  reorderPoint?: number;
  stock: number;
  sku: string;
  images?: ProductImage[];
  imageUrls?: string[];
  imageAlts?: string[];
};

/** `null`: la etiqueta del fabricante no declara ese valor. */
export type NutritionalFacts = {
  servingSize: string;
  calories: number | null;
  protein: number | null;
  carbohydrates: number | null;
  fats: number | null;
};

export type Product = {
  revision?: number;
  id: string;
  title: string;
  brand: string;
  slug: string;
  shortDescription: string;
  productType: "SUPPLEMENT" | "APPAREL";
  nutritionalFacts?: NutritionalFacts | null;
  primaryImage?: ProductImage | null;
  priceRange: MoneyRange;
  variants: ProductVariant[];
  categories: TaxonomyRef[];
  goals: TaxonomyRef[];
  vitalCoinsReward: number;
  maxInstallments: number;
  hasFreeShipping: boolean;
  storeBadges?: string[];
  featured?: boolean;
  active: boolean;
};

export type ProductStatus = "ACTIVE" | "ARCHIVED" | "ALL";

/** Pedido consultado por un invitado: sin contacto ni dirección. */
export type TrackedOrder = {
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  createdAt: string;
  /** Transferencia: plazo de pago. Contra entrega sin confirmar: plazo para confirmar por WhatsApp. */
  reservedUntil?: string | null;
  /** Contra entrega pendiente de confirmar por WhatsApp. */
  awaitingConfirmation?: boolean;
  shippingMethod: ShippingMethod;
  subtotal: number;
  discount?: OrderDiscount | null;
  shippingFee: number;
  total: number;
  items: Array<{ title: string; variantLabel: string; quantity: number; lineTotal: number }>;
};

export type StoreLegal = { storeName: string; legalName?: string | null; ruc?: string | null; address?: string | null; email?: string | null; whatsapp?: string | null; reservationHours: number };

export type CampaignTheme = "NOCHE" | "ORO" | "CLARO";
/** Campaña visible en la tienda: texto editorial y productos vigentes del catálogo. */
export type Campaign = {
  id: string;
  slug: string;
  title: string;
  eyebrow: string;
  message: string;
  ctaLabel: string;
  theme: CampaignTheme;
  startsOn: string;
  endsOn: string;
  imageUrl?: string | null;
  products: Product[];
};
export type CampaignStatus = "LIVE" | "SCHEDULED" | "ENDED" | "PAUSED";
/** Registro que edita el panel: selección por objetivo, marca o productos elegidos. */
export type CampaignRecord = Omit<Campaign, "products" | "imageUrl"> & {
  imageUrl: string;
  active: boolean;
  priority: number;
  goals: string[];
  brands: string[];
  productIds: string[];
  revision: number;
  suggested: boolean;
  updatedByName: string;
  updatedAt: string;
  status: CampaignStatus;
};

export type ProductFilters = {
  sort?: "PRICE_ASC" | "PRICE_DESC";
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  featured?: boolean;
  search?: string;
  brands?: string[];
  goals?: string[];
  flavors?: string[];
  status?: ProductStatus;
};

export type PageInfo = { endCursor?: string | null; hasNextPage: boolean };
export type ProductConnection = {
  edges: Array<{ cursor: string; node: Product }>;
  pageInfo: PageInfo;
  totalCount: number;
};

export type CartItem = {
  productId: string;
  variantSku: string;
  title: string;
  variantLabel: string;
  image?: string;
  unitPrice: number;
  quantity: number;
  vitalCoinsReward: number;
  /** Existencias conocidas al agregar. Solo limita la interfaz; el servidor decide. */
  maxQuantity?: number;
};

export type CartTotals = {
  subtotal: number;
  /** Descuento de bienvenida sobre los productos (C46); 0 sin código válido. */
  discount: number;
  discountCode?: string | null;
  discountPercent?: number | null;
  /** Por qué no aplica el código, o la condición de primera compra si aplica. */
  discountMessage?: string | null;
  shippingFee: number;
  total: number;
  earnedCoins: number;
  freeShippingThreshold: number;
  amountUntilFreeShipping: number;
  hasFreeShipping: boolean;
};

/** Lo que edita y envia el panel: aqui `size` e `images` si son obligatorios. */
export type VariantDraft = {
  flavor: string;
  size: ProductSize;
  price: number;
  compareAtPrice?: number | null;
  reorderPoint?: number;
  stock: number;
  sku: string;
  images: ProductImage[];
};

export type PaymentMethod = "BANK_TRANSFER" | "CASH_ON_DELIVERY";
export type ShippingMethod = "EXPRESS_QUITO_VALLES" | "SERVIENTREGA_NATIONAL";
export type OrderStatus = "PENDING_PAYMENT" | "PAYMENT_REVIEW" | "PAID" | "PREPARING" | "SHIPPED" | "COMPLETED" | "CANCELLED" | "RETURNED";
export type OrderCustomer = {
  fullName: string;
  email: string;
  phone: string;
  province: string;
  city: string;
  address: string;
  reference?: string | null;
  /** Identificación para la factura: CEDULA, RUC o PASAPORTE. */
  idType?: "CEDULA" | "RUC" | "PASAPORTE" | "" | null;
  idNumber?: string | null;
};
export type OrderItem = {
  productId: string;
  variantSku: string;
  title: string;
  variantLabel: string;
  image?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Parte del descuento del pedido que corresponde a la línea (C46). */
  discount?: number | null;
};
/** Descuento de bienvenida aplicado a un pedido (C46). */
export type OrderDiscount = { code: string; percent: number; amount: number };
export type Order = {
  id: string;
  orderNumber: string;
  customer: OrderCustomer;
  items: OrderItem[];
  shippingMethod: ShippingMethod;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  allowedNextStatuses?: OrderStatus[];
  paidAt?: string | null;
  /** Contra entrega confirmada por WhatsApp (C36). */
  confirmedAt?: string | null;
  deliveryLocation?: string | null;
  subtotal: number;
  discount?: OrderDiscount | null;
  shippingFee: number;
  total: number;
  notes?: string | null;
  paymentReference?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type UserRole = "CUSTOMER" | "CATALOG" | "WAREHOUSE" | "MANAGER" | "ADMIN";
export type UserStatus = "ACTIVE" | "BLOCKED";
export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt?: string | null;
  lastLoginAt?: string | null;
};
export type AuthPayload = { token: string; user: AuthUser };

export type OrderConnection = { orders: Order[]; totalCount: number };

export type AdminStats = {
  catalog: { active: number; archived: number; featured: number; stock: number };
  accounts: { customers: number; admins: number; blocked: number };
  orders: { total: number; pendingPayment: number; revenue: number };
};

export type StoreSettings = {
  persistence: string;
  freeShippingThreshold: number;
  freeShippingMethods?: ShippingMethod[];
  shippingRates: Array<{ method: ShippingMethod; fee: number }>;
  paymentMethods: PaymentMethod[];
  notifications: {
    email: { enabled: boolean; operator: string; bankDetailsReady: boolean };
    telegram: { enabled: boolean };
  };
};

export type TaxonomyKind = "CATEGORY" | "GOAL" | "BRAND";
export type TaxonomyAction = "RENAME" | "MERGE" | "REMOVE";
export type TaxonomyEntry = { key: string; name: string; productCount: number };
export type TaxonomyOverview = {
  categories: TaxonomyEntry[];
  goals: TaxonomyEntry[];
  brands: TaxonomyEntry[];
};

export type CheckoutInfo = {
  /** null cuando la tienda da los datos de transferencia por WhatsApp. */
  bank?: { name: string; accountType: string; accountNumber: string; holder: string } | null;
  freeShippingThreshold: number;
  /** Métodos con envío gratis desde el umbral; vacío = nunca gratis. */
  freeShippingMethods: ShippingMethod[];
  shippingRates: Array<{ method: string; fee: number }>; notifiesByEmail: boolean; whatsapp?: string | null;
  /** Horas que se reserva el stock de un pedido sin pago antes de cancelarlo. */
  reservationHours: number;
  /** Pago contra entrega: el servidor aplica la misma regla al crear el pedido. */
  cashOnDelivery: { enabled: boolean; expressOnly: boolean; minimumSubtotal: number; confirmHours: number };
  /** Descuento de bienvenida vigente (C46); `code` es null si la tienda no lo anuncia. */
  welcomeDiscount?: { percent: number; minimumSubtotal: number; endsOn?: string | null; code?: string | null } | null };

/** Reglas comerciales que edita Administración en el panel. */
export type CommerceSettings = {
  bank: { name: string; accountType: string; accountNumber: string; holder: string; document: string };
  shippingFees: Record<ShippingMethod, number>;
  freeShippingThreshold: number;
  freeShippingMethods: ShippingMethod[];
  cashOnDelivery: { enabled: boolean; expressOnly: boolean; minimumSubtotal: number; confirmHours: number };
  /** false: la web no muestra la cuenta; se envía por WhatsApp. */
  showBankDetails: boolean;
  /** Descuento de bienvenida con código (C46). */
  welcomeDiscount: { enabled: boolean; code: string; percent: number; minimumSubtotal: number; endsOn: string | null; showOnStore: boolean };
  revision: number;
  updatedByName: string;
  updatedAt: string | null;
};

/** Bandeja de avisos (correo y Telegram) que el servidor reintenta. */
export type NotificationOutboxSummary = {
  pending: number;
  failed: number;
  failures: Array<{ id: string; label: string; attempts: number; lastError: string; createdAt: string }>;
};
