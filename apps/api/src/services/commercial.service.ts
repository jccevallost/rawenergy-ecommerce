import { orderService } from "./order.service.js";
import { supplyService } from "./supply.service.js";

type Position = { productId: string; title: string; sku: string; warehouseId: string; lot: string; expiresOn: string; onHand: number; reserved: number; available: number; unitCost: number | null };
export function stockSummary(positions: Position[], now = new Date()) {
  const today = new Date(now.getTime() - 5 * 3600000).toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + 30 * 86400000 - 5 * 3600000).toISOString().slice(0, 10);
  const rows = positions.filter(p => p.onHand > 0);
  const known = (p: Position) => typeof p.unitCost === "number" && Number.isFinite(p.unitCost) && p.unitCost >= 0;
  const total = (items: Position[]) => ({ units: items.reduce((s, p) => s + p.onHand, 0), knownValue: Math.round(items.reduce((s, p) => s + (known(p) ? p.onHand * p.unitCost! : 0), 0) * 100) / 100, unknownUnits: items.filter(p => !known(p)).reduce((s, p) => s + p.onHand, 0) });
  const expired = rows.filter(p => p.expiresOn && p.expiresOn < today);
  const expiring = rows.filter(p => p.expiresOn && p.expiresOn >= today && p.expiresOn <= horizon);
  return { ...total(rows), reserved: rows.reduce((s, p) => s + p.reserved, 0), expired: total(expired), expiring: total(expiring), risks: [...expired, ...expiring].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn)).slice(0, 6), riskLots: expired.length + expiring.length };
}
export const commercialService = {
  async overview() {
    const [orders, positions, purchases, suppliers] = await Promise.all([orderService.pendingSummary(), supplyService.positions(), supplyService.purchases("ORDERED"), supplyService.suppliers()]);
    const now = new Date(), today = new Date(now.getTime() - 5 * 3600000).toISOString().slice(0, 10);
    return { orders, stock: stockSummary(positions, now), purchases: { count: purchases.length, amount: Math.round(purchases.reduce((s, p) => s + p.total, 0) * 100) / 100, overdue: purchases.filter(p => p.expectedOn && p.expectedOn < today).length, rows: purchases.map(p => ({ id: p.id, number: p.number, total: p.total, expectedOn: p.expectedOn, supplier: suppliers.find(s => s.id === p.supplierId)?.name ?? "Proveedor sin nombre" })).sort((a, b) => (a.expectedOn || "9999").localeCompare(b.expectedOn || "9999")).slice(0, 5) }, updatedAt: now.toISOString() };
  }
};
