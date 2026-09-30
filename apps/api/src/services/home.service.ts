import { productService } from "./product.service.js";
import { orderService } from "./order.service.js";
import { auditService } from "./audit.service.js";
import { supplyService } from "./supply.service.js";
import { permissions, type Role } from "./permissions.js";
export const homeService = {
  async overview(role: Role) {
    const allowed = permissions[role];
    const products = await productService.allForManagement();
    const active = products.filter((p) => p.active !== false);
    const stock = active.flatMap((p) => p.variants.map((v) => ({ productId: String("id" in p ? p.id : p._id), title: p.title, sku: v.sku, stock: v.stock, minimum: v.reorderPoint ?? 5 })));
    const missing = active.filter((p) => !p.variants.some((v) => v.images.length) || !p.categories.length).map((p) => ({ id: String("id" in p ? p.id : p._id), title: p.title }));
    const orders = allowed.includes("orders.read") ? await orderService.list({ status: "PAYMENT_REVIEW" }, { limit: 5 }) : null;
    const unpaid = allowed.includes("orders.read") ? await orderService.list({ status: "PENDING_PAYMENT" }, { limit: 1 }) : null;
    const purchases = allowed.includes("purchases.read") ? (await supplyService.purchases()).filter((p) => p.status === "ORDERED") : [];
    const lots = allowed.includes("inventory.read") ? await supplyService.positions() : [];
    const cutoff = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const failures = allowed.includes("audit.read") ? await auditService.list({ status: "FAILED", from: new Date(Date.now() - 86400000).toISOString(), limit: 5 }) : null;
    return { persistence: productService.persistenceMode, activeProducts: active.length, missingProducts: missing, lowStock: allowed.includes("inventory.read") ? stock.filter((v) => v.stock <= v.minimum) : [], reviewOrders: orders, pendingPayment: unpaid?.totalCount ?? 0, pendingPurchases: purchases, expiringLots: lots.filter((l) => l.quantity > 0 && l.expiresOn && l.expiresOn <= cutoff), failures, updatedAt: new Date().toISOString() };
  }
};
