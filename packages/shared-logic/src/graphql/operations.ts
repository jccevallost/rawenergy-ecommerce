import { gql } from "@apollo/client";

export const PRODUCT_FIELDS = gql`
  fragment ProductFields on Product {
    id title revision brand slug shortDescription productType featured active
    primaryImage { url alt }
    priceRange { min max }
    nutritionalFacts { servingSize calories protein carbohydrates fats }
    categories { name slug }
    goals { name slug }
    variants {
      id flavor sizeValue sizeUnit price compareAtPrice stock reorderPoint sku imageUrls imageAlts
    }
  }
`;

export const AUTH_FIELDS = gql`
  fragment AuthFields on AuthPayload {
    token
    user { id name email role status createdAt lastLoginAt twoFactorEnabled twoFactorRequired emailVerified }
  }
`;

export const ORDER_FIELDS = gql`
  fragment OrderFields on Order {
    id orderNumber shippingMethod paymentMethod status allowedNextStatuses paidAt confirmedAt deliveryLocation subtotal discount { code percent amount } shippingFee total notes paymentReference createdAt updatedAt
    customer { fullName email phone province city address reference idType idNumber }
    recipient { name phone sameAsBuyer addressLabel }
    invoice { name idType idNumber email sameAsBuyer }
    items { productId variantSku title variantLabel image quantity unitPrice lineTotal discount }
  }
`;

export const GET_PRODUCTS_BY_GOAL = gql`
  ${PRODUCT_FIELDS}
  query GetProductsByGoal($goalSlug: String!, $limit: Int) {
    getProductsByGoal(goalSlug: $goalSlug, limit: $limit) { ...ProductFields }
  }
`;

export const PRODUCT_BY_SLUG = gql`
  ${PRODUCT_FIELDS}
  query ProductBySlug($slug: String!) {
    productBySlug(slug: $slug) { ...ProductFields ingredients usage warnings }
  }
`;

export const CAMPAIGN_FIELDS = gql`
  fragment CampaignFields on Campaign { id slug title eyebrow message ctaLabel theme startsOn endsOn imageUrl }
`;

export const ACTIVE_CAMPAIGNS = gql`
  ${PRODUCT_FIELDS}
  ${CAMPAIGN_FIELDS}
  query ActiveCampaigns($limit: Int) {
    activeCampaigns { ...CampaignFields products(limit: $limit) { ...ProductFields } }
  }
`;

export const CAMPAIGN_BY_SLUG = gql`
  ${PRODUCT_FIELDS}
  ${CAMPAIGN_FIELDS}
  query CampaignBySlug($slug: String!, $limit: Int) {
    campaign(slug: $slug) { ...CampaignFields products(limit: $limit) { ...ProductFields } }
  }
`;

export const TRACK_ORDER = gql`
  query TrackOrder($orderNumber: String!, $contact: String!) {
    trackOrder(orderNumber: $orderNumber, contact: $contact) {
      orderNumber status paymentMethod createdAt reservedUntil awaitingConfirmation shippingMethod subtotal discount { code percent amount } shippingFee total
      items { title variantLabel quantity lineTotal }
    }
  }
`;

export const STORE_LEGAL = gql`query StoreLegal { storeLegal { storeName legalName ruc address email whatsapp reservationHours } }`;

export const COMMERCE_SETTINGS = gql`query CommerceSettings { commerceSettings }`;
export const SAVE_COMMERCE_SETTINGS = gql`mutation SaveCommerceSettings($input: JSON!, $revision: Int!) { saveCommerceSettings(input: $input, revision: $revision) }`;
export const NOTIFICATION_OUTBOX = gql`query NotificationOutbox { notificationOutbox }`;
export const RETRY_FAILED_NOTIFICATIONS = gql`mutation RetryFailedNotifications { retryFailedNotifications }`;

export const ADMIN_CAMPAIGNS = gql`query AdminCampaigns { adminCampaigns }`;
export const SAVE_CAMPAIGN = gql`mutation SaveCampaign($id: ID!, $input: JSON!, $revision: Int) { saveCampaign(id: $id, input: $input, revision: $revision) }`;
export const DELETE_CAMPAIGN = gql`mutation DeleteCampaign($id: ID!, $revision: Int!) { deleteCampaign(id: $id, revision: $revision) }`;
export const SET_PRODUCT_FEATURED = gql`
  mutation SetProductFeatured($id: ID!, $featured: Boolean!, $revision: Int!) {
    setProductFeatured(id: $id, featured: $featured, revision: $revision) { id featured revision }
  }
`;

export const SEARCH_PRODUCTS = gql`
  ${PRODUCT_FIELDS}
  query SearchProducts($filters: ProductFiltersInput, $pagination: CursorPaginationInput) {
    searchProducts(filters: $filters, pagination: $pagination) {
      edges { cursor node { ...ProductFields } }
      pageInfo { endCursor hasNextPage }
      totalCount
    }
  }
`;

export const GET_ADMIN_PRODUCTS = gql`
  ${PRODUCT_FIELDS}
  query GetAdminProducts($filters: ProductFiltersInput, $pagination: CursorPaginationInput) {
    searchProducts(filters: $filters, pagination: $pagination) {
      edges { cursor node { ...ProductFields ingredients usage warnings } }
      pageInfo { endCursor hasNextPage }
      totalCount
    }
  }
`;

export const CALCULATE_CART_TOTALS = gql`
  query CalculateCartTotals($cartItems: [CartItemInput!]!, $shippingMethod: ShippingMethod, $discountCode: String) {
    calculateCartTotals(cartItems: $cartItems, shippingMethod: $shippingMethod, discountCode: $discountCode) {
      subtotal discount discountCode discountPercent discountMessage shippingFee total freeShippingThreshold amountUntilFreeShipping hasFreeShipping
    }
  }
`;

export const CREATE_CHECKOUT_ORDER = gql`
  ${ORDER_FIELDS}
  mutation CreateCheckoutOrder($input: CheckoutInput!) {
    createCheckoutOrder(input: $input) { ...OrderFields }
  }
`;

export const ORDERS = gql`
  ${ORDER_FIELDS}
  query Orders($filters: OrderFiltersInput, $limit: Int, $offset: Int) {
    orders(filters: $filters, limit: $limit, offset: $offset) {
      orders { ...OrderFields }
      totalCount
    }
  }
`;

export const MY_ORDERS = gql`
  ${ORDER_FIELDS}
  query MyOrders($limit: Int) {
    myOrders(limit: $limit) { ...OrderFields }
  }
`;

/** Une un producto como presentaciones de otro (C49). */
export const MERGE_PRODUCTS = gql`mutation MergeProducts($input: JSON!) { mergeProducts(input: $input) }`;

/** Enlaza a la cuenta pedidos hechos sin sesión: número + correo de la cuenta (C44). */
export const LINK_GUEST_ORDERS = gql`
  mutation LinkGuestOrders($orderNumbers: [String!]!) {
    linkGuestOrders(orderNumbers: $orderNumbers) { linked orderNumbers }
  }
`;

export const ADMIN_STATS = gql`
  query AdminStats {
    adminStats {
      catalog { active archived featured stock }
      accounts { customers admins blocked }
      orders { total pendingPayment revenue }
    }
  }
`;

export const CHECKOUT_INFO = gql`
  query CheckoutInfo {
    checkoutInfo { bank { name accountType accountNumber holder } notifiesByEmail whatsapp captchaSiteKey customerAccounts reservationHours freeShippingThreshold freeShippingMethods shippingRates { method fee } cashOnDelivery { enabled expressOnly minimumSubtotal confirmHours } welcomeDiscount { percent minimumSubtotal endsOn code } }
  }
`;

export const CHECK_EMAIL = gql`
  query CheckEmail($email: String!) { checkEmail(email: $email) { ok message suggestion } }
`;

export const TAXONOMY = gql`
  query Taxonomy {
    taxonomy {
      categories { key name productCount }
      goals { key name productCount }
      brands { key name productCount }
    }
  }
`;

export const EDIT_TAXONOMY = gql`
  mutation EditTaxonomy($kind: TaxonomyKind!, $action: TaxonomyAction!, $key: String!, $target: String) {
    editTaxonomy(kind: $kind, action: $action, key: $key, target: $target)
  }
`;

export const STORE_SETTINGS = gql`
  query StoreSettings {
    storeSettings {
      persistence
      freeShippingThreshold
      freeShippingMethods
      shippingRates { method fee }
      paymentMethods
      notifications {
        email { enabled operator bankDetailsReady }
        telegram { enabled }
      }
    }
  }
`;

export const CONFIRM_CASH_ON_DELIVERY = gql`
  ${ORDER_FIELDS}
  mutation ConfirmCashOnDeliveryOrder($id: ID!, $location: String) {
    confirmCashOnDeliveryOrder(id: $id, location: $location) { ...OrderFields }
  }
`;

export const UPDATE_ORDER_STATUS = gql`
  ${ORDER_FIELDS}
  mutation UpdateOrderStatus($id: ID!, $status: OrderStatus!) {
    updateOrderStatus(id: $id, status: $status) { ...OrderFields }
  }
`;

export const UPSERT_PRODUCT = gql`
  mutation UpsertProduct($id: ID, $payload: JSON!, $expectedStocks: JSON, $expectedRevision: Int) {
    upsertProduct(id: $id, payload: $payload, expectedStocks: $expectedStocks, expectedRevision: $expectedRevision) { id title slug priceRange { min max } }
  }
`;

export const DELETE_PRODUCT = gql`
  mutation DeleteProduct($id: ID!) {
    deleteProduct(id: $id)
  }
`;

export const UPDATE_USER_STATUS = gql`
  mutation UpdateUserStatus($id: ID!, $status: UserStatus!) {
    updateUserStatus(id: $id, status: $status) { id name email role status createdAt lastLoginAt }
  }
`;

export const UPDATE_USER_ROLE = gql`
  mutation UpdateUserRole($id: ID!, $role: UserRole!) {
    updateUserRole(id: $id, role: $role) { id name email role status createdAt lastLoginAt }
  }
`;

export const RESTORE_PRODUCT = gql`
  ${PRODUCT_FIELDS}
  mutation RestoreProduct($id: ID!) {
    restoreProduct(id: $id) { ...ProductFields }
  }
`;

export const LOGIN = gql`
  ${AUTH_FIELDS}
  mutation Login($input: LoginInput!) {
    login(input: $input) { ...AuthFields }
  }
`;

// CU04: el alta no inicia sesión; la cuenta se activa al confirmar el correo. Respuesta uniforme (D05).
export const REGISTER = gql`
  mutation Register($input: RegisterInput!) {
    register(input: $input) { accepted deliveryAvailable }
  }
`;

export const LOGOUT = gql`mutation Logout { logout }`;

// CU03/CU05: perfil y libreta de direcciones del cliente.
export const CUSTOMER_PROFILE_FIELDS = gql`
  fragment CustomerProfileFields on CustomerProfile {
    name email phone altPhone revision maxAddresses complete missing defaultAddressId firstPurchase
    billing { name idType idNumber email }
    addresses { id label province city address reference recipientName recipientPhone isDefault createdAt updatedAt }
  }
`;
export const MY_PROFILE = gql`
  ${CUSTOMER_PROFILE_FIELDS}
  query MyProfile { myProfile { ...CustomerProfileFields } }
`;
export const UPDATE_MY_CONTACT = gql`
  ${CUSTOMER_PROFILE_FIELDS}
  mutation UpdateMyContact($input: CustomerContactInput!, $revision: Int!) { updateMyContact(input: $input, revision: $revision) { ...CustomerProfileFields } }
`;
export const UPDATE_MY_BILLING = gql`
  ${CUSTOMER_PROFILE_FIELDS}
  mutation UpdateMyBilling($input: CustomerBillingInput, $revision: Int!) { updateMyBilling(input: $input, revision: $revision) { ...CustomerProfileFields } }
`;
export const ADD_MY_ADDRESS = gql`
  ${CUSTOMER_PROFILE_FIELDS}
  mutation AddMyAddress($input: CustomerAddressInput!, $revision: Int!, $makeDefault: Boolean) { addMyAddress(input: $input, revision: $revision, makeDefault: $makeDefault) { addressId duplicate madeDefault profile { ...CustomerProfileFields } } }
`;
export const UPDATE_MY_ADDRESS = gql`
  ${CUSTOMER_PROFILE_FIELDS}
  mutation UpdateMyAddress($id: ID!, $input: CustomerAddressInput!, $revision: Int!) { updateMyAddress(id: $id, input: $input, revision: $revision) { ...CustomerProfileFields } }
`;
export const REMOVE_MY_ADDRESS = gql`
  ${CUSTOMER_PROFILE_FIELDS}
  mutation RemoveMyAddress($id: ID!, $revision: Int!, $nextDefaultId: ID) { removeMyAddress(id: $id, revision: $revision, nextDefaultId: $nextDefaultId) { ...CustomerProfileFields } }
`;
export const SET_MY_DEFAULT_ADDRESS = gql`
  ${CUSTOMER_PROFILE_FIELDS}
  mutation SetMyDefaultAddress($id: ID!, $revision: Int!) { setMyDefaultAddress(id: $id, revision: $revision) { ...CustomerProfileFields } }
`;
export const MY_SESSIONS = gql`query MySessions { mySessions }`;

// CU09: pedidos del cliente con su propia proyección.
export const CUSTOMER_ORDER_FIELDS = gql`
  fragment CustomerOrderFields on CustomerOrder {
    orderNumber createdAt status paymentMethod shippingMethod confirmedAt paidAt subtotal shippingFee total
    discount { code percent amount }
    items { variantSku title variantLabel image quantity unitPrice lineTotal returnedQuantity }
    delivery { province city address reference }
    recipient { name phone sameAsBuyer addressLabel }
    invoice { name idType idNumber email sameAsBuyer }
    events { status at note }
    refund { at amount }
    cancellation { canCancel canRequestCancellation reason blocksAccount }
    cancellationRequest { status reason createdAt decidedAt publicNote }
  }
`;
export const MY_ORDERS_PAGE = gql`
  ${CUSTOMER_ORDER_FIELDS}
  query MyOrdersPage($first: Int, $after: String, $filter: CustomerOrderFilter) {
    myOrdersPage(first: $first, after: $after, filter: $filter) { hasMore nextCursor orders { ...CustomerOrderFields } }
  }
`;
export const CANCEL_MY_ORDER = gql`
  ${CUSTOMER_ORDER_FIELDS}
  mutation CancelMyOrder($number: String!) { cancelMyOrder(number: $number) { alreadyCancelled accountBlocked order { ...CustomerOrderFields } } }
`;
export const REQUEST_ORDER_CANCELLATION = gql`
  ${CUSTOMER_ORDER_FIELDS}
  mutation RequestOrderCancellation($number: String!, $reason: CancellationReason!, $note: String) { requestOrderCancellation(number: $number, reason: $reason, note: $note) { ...CustomerOrderFields } }
`;
export const MY_ORDER = gql`
  ${CUSTOMER_ORDER_FIELDS}
  query MyOrder($number: String!) { myOrder(number: $number) { ...CustomerOrderFields } }
`;
export const REVOKE_SESSIONS = gql`mutation RevokeSessions { revokeSessions }`;
export const VERIFY_EMAIL = gql`mutation VerifyEmail($token: String!) { verifyEmail(token: $token) }`;
export const RESEND_VERIFICATION = gql`mutation ResendVerification($email: String!) { resendVerification(email: $email) { accepted deliveryAvailable } }`;
export const REQUEST_PASSWORD_RESET = gql`mutation RequestPasswordReset($email: String!) { requestPasswordReset(email: $email) }`;
export const RESET_PASSWORD = gql`mutation ResetPassword($token: String!, $password: String!) { resetPassword(token: $token, password: $password) }`;
export const REQUEST_EMAIL_CHANGE = gql`mutation RequestEmailChange($email: String!, $password: String!) { requestEmailChange(email: $email, password: $password) { accepted deliveryAvailable } }`;
export const CONFIRM_EMAIL_CHANGE = gql`mutation ConfirmEmailChange($token: String!) { confirmEmailChange(token: $token) }`;

export const ME = gql`
  query Me {
    me { id name email role status createdAt lastLoginAt twoFactorEnabled twoFactorRequired emailVerified }
  }
`;

export const USERS = gql`
  query Users($role: UserRole) {
    users(role: $role) { id name email role status createdAt lastLoginAt }
  }
`;

// Tipos de producto con productos activos y su cantidad (C65): filtros, portada y sugerencias.
export const CATALOG_CATEGORIES = gql`
  query CatalogCategories {
    catalogCategories { slug name count }
  }
`;
