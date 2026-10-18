// RES-01 (M18): resultados por orden de compra con el origen de cada unidad hasta su venta.
//
// Cada venta guarda de qué capa salió cada unidad (M40), y cada capa recibida guarda su compra. Así se suman,
// por compra, las unidades vendidas, el ingreso atribuido (la parte cobrada de cada línea, proporcional a sus
// unidades), el costo consumido a costo histórico, las devoluciones, los cambios enviados al proveedor y lo
// que queda en inventario. Es margen bruto realizado: no incluye gastos, fletes ni impuestos, y las ventas de
// saldos anteriores al registro de capas se informan aparte como «sin atribución», sin inventar su compra.
import { supplyService } from "./supply.service.js";
import { orderService } from "./order.service.js";
import { saleStatuses } from "./management.service.js";
import { exchangeService } from "./exchange.service.js";
import type { StockLot } from "./stockLedger.service.js";

type SaleOrder = { status: string; createdAt: Date | string; items: Array<{ productId: string; variantSku: string; quantity: number; lineTotal: number; discount?: number | null; allocations?: StockLot[] }>; returns?: Array<{ items: Array<{ variantSku: string; allocations: StockLot[] }> }> };
export type PurchaseResult = {
  purchaseId: string; number: string; supplierName: string; receivedOn: string | null; documentNumber: string | null;
  unitsReceived: number; purchaseTotal: number; unitsSold: number; unitsReturned: number; unitsExchanged: number; unitsRemaining: number;
  revenue: number; costSold: number | null; grossProfit: number | null; remainingCostValue: number | null; recoveredPercent: number | null;
};
const round = (n: number) => Math.round(n * 100) / 100;

export function computePurchaseResults(input: {
  purchases: Array<{ id: string; number: string; supplierId: string; status: string; total: number; receivedOn?: string; items: Array<{ quantity: number }>; document?: { number: string } }>;
  suppliers: Array<{ id: string; name: string }>; orders: SaleOrder[];
  positions: Array<{ purchaseId?: string; onHand: number; unitCost: number | null }>;
  exchanges: Array<{ status: string; items: Array<{ quantity: number; lot: StockLot }> }>;
}) {
  const rows = new Map<string, { sold: number; returned: number; revenue: number; cost: number; costKnown: boolean }>();
  const row = (id: string) => rows.get(id) ?? (rows.set(id, { sold: 0, returned: 0, revenue: 0, cost: 0, costKnown: true }), rows.get(id)!);
  let unattributedUnits = 0, unattributedRevenue = 0;
  for (const order of input.orders.filter(o => saleStatuses.has(o.status))) {
    for (const item of order.items) {
      const net = item.lineTotal - (item.discount ?? 0);
      const returnedLots = (order.returns ?? []).flatMap(r => r.items.filter(i => i.variantSku === item.variantSku).flatMap(i => i.allocations));
      for (const alloc of item.allocations?.length ? item.allocations : [{ quantity: item.quantity, unitCost: null } as unknown as StockLot]) {
        const back = returnedLots.filter(r => r.layerId && r.layerId === alloc.layerId && r.warehouseId === alloc.warehouseId).reduce((s, r) => s + r.quantity, 0);
        const kept = Math.max(0, alloc.quantity - back), share = net * kept / item.quantity;
        if (!alloc.purchaseId) { unattributedUnits += kept; unattributedRevenue += share; continue; }
        const r = row(alloc.purchaseId);
        r.sold += kept; r.returned += Math.min(back, alloc.quantity); r.revenue += share;
        if (alloc.unitCost === null || alloc.unitCost === undefined) r.costKnown = false; else r.cost += alloc.unitCost * kept;
      }
    }
  }
  const names = new Map(input.suppliers.map(s => [s.id, s.name]));
  const results: PurchaseResult[] = input.purchases.filter(p => p.status === "RECEIVED" || p.status === "PARTIAL").map(p => {
    const r = rows.get(p.id) ?? { sold: 0, returned: 0, revenue: 0, cost: 0, costKnown: true };
    const remaining = input.positions.filter(x => x.purchaseId === p.id);
    const exchanged = input.exchanges.filter(e => e.status !== "ANULADO").flatMap(e => e.items).filter(i => i.lot.purchaseId === p.id).reduce((s, i) => s + i.quantity, 0);
    const costSold = r.costKnown ? round(r.cost) : null;
    return {
      purchaseId: p.id, number: p.number, supplierName: names.get(p.supplierId) ?? "", receivedOn: p.receivedOn ?? null, documentNumber: p.document?.number ?? null,
      unitsReceived: p.items.reduce((s, i) => s + ((i as { receivedQuantity?: number }).receivedQuantity ?? i.quantity), 0), purchaseTotal: p.total, unitsSold: r.sold, unitsReturned: r.returned, unitsExchanged: exchanged,
      unitsRemaining: remaining.reduce((s, x) => s + x.onHand, 0), revenue: round(r.revenue), costSold, grossProfit: costSold === null ? null : round(r.revenue - costSold),
      remainingCostValue: remaining.every(x => x.unitCost !== null) ? round(remaining.reduce((s, x) => s + x.onHand * (x.unitCost ?? 0), 0)) : null,
      recoveredPercent: p.total > 0 ? round(r.revenue / p.total * 100) : null
    };
  }).sort((a, b) => (b.receivedOn ?? "").localeCompare(a.receivedOn ?? ""));
  return { purchases: results, unattributed: { units: unattributedUnits, revenue: round(unattributedRevenue) } };
}

export const purchaseResultsService = {
  async overview() {
    const [purchases, suppliers, orders, positions, exchanges] = await Promise.all([supplyService.purchases(), supplyService.suppliers(), orderService.forManagement(new Date(Date.UTC(2020, 0, 1)), new Date()), supplyService.positions(), exchangeService.list()]);
    return computePurchaseResults({ purchases: purchases as never, suppliers, orders: orders as unknown as SaleOrder[], positions, exchanges });
  }
};
