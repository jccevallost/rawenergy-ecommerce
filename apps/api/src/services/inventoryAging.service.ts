// ROT-01 (M29, M30): antigüedad de la mercadería por recepción y productos con poca salida.
//
// Decisiones del propietario (14/10/2026): seis meses de permanencia son un objetivo interno para gestionar
// un cambio, no una caducidad ni un plazo del proveedor; los umbrales deben adaptarse a la venta real de
// cada producto. La regla vive solo aquí, en el servidor, y la usan el panel web, Windows y el móvil.
//
// - Edad: desde la fecha efectiva de recepción de cada capa; reponer o trasladar no la reinicia (M40).
// - Velocidad: unidades vendidas en la ventana ÷ días en que hubo stock disponible. Los días sin stock no
//   cuentan como falta de demanda. Con menos días de historial que el mínimo, no se proyecta.
// - Unidades que sobrarán: lo que queda de cada capa al llegar a su objetivo, vendiendo primero lo más antiguo.
import type { LayerPosition } from "./inventoryPositions.js";

export type AgingConfig = { targetMonths: number; prepareDays: number; priorityDays: number; windowDays: number; minHistoryDays: number };
export const defaultAgingConfig: AgingConfig = { targetMonths: 6, prepareDays: 60, priorityDays: 30, windowDays: 90, minHistoryDays: 30 };
export type AgingStatus = "EN_PLAZO" | "PREPARAR" | "PRIORITARIO" | "OBJETIVO_ALCANZADO" | "SIN_FECHA";
export type AgingLayer = {
  productId: string; sku: string; title: string; warehouseId: string; layerId: string; lot: string; expiresOn: string;
  receivedOn: string; ageDays: number | null; targetOn: string | null; daysToTarget: number | null; status: AgingStatus;
  onHand: number; reserved: number; available: number; unitCost: number | null; costValue: number | null;
  leftoverAtTarget: number | null; expiresBeforeTarget: boolean; purchaseId?: string; supplierId?: string; supplierName?: string;
};
export type SlowProduct = {
  productId: string; sku: string; title: string; onHand: number; unitsSold: number; daysWithStock: number;
  dailyVelocity: number | null; history: "SUFICIENTE" | "INSUFICIENTE"; reason: "SOBRARAN" | "SIN_VENTAS" | null;
  leftoverAtTarget: number | null; oldestReceivedOn: string | null; costValue: number | null; costComplete: boolean;
};

const DAY = 86_400_000;
const parseDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Suma meses calendario; si el día no existe en el mes destino se usa el último día de ese mes. */
export function addMonths(iso: string, months: number) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)) - 1 + months, d = Number(iso.slice(8, 10));
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toDay(Date.UTC(y, m, Math.min(d, last)));
}
const round2 = (n: number) => Math.round(n * 100) / 100;
export function statusFor(daysToTarget: number | null, config: AgingConfig): AgingStatus {
  if (daysToTarget === null) return "SIN_FECHA";
  if (daysToTarget <= 0) return "OBJETIVO_ALCANZADO";
  if (daysToTarget <= config.priorityDays) return "PRIORITARIO";
  if (daysToTarget <= config.prepareDays) return "PREPARAR";
  return "EN_PLAZO";
}

export function computeAging(input: {
  positions: LayerPosition[]; today: string; config?: AgingConfig;
  unitsSold: Map<string, number>; daysWithStock: Map<string, number>;
  suppliers?: Map<string, { supplierId: string; supplierName: string }>;
}) {
  const config = input.config ?? defaultAgingConfig, today = parseDay(input.today);
  const key = (p: { productId: string; sku: string }) => `${p.productId}:${p.sku}`;
  const velocity = (k: string) => { const days = input.daysWithStock.get(k) ?? 0; return days >= config.minHistoryDays ? (input.unitsSold.get(k) ?? 0) / days : null; };
  const layers: AgingLayer[] = input.positions.filter(p => p.onHand > 0).map(p => {
    const known = /^\d{4}-\d{2}-\d{2}$/.test(p.receivedOn);
    const targetOn = known ? addMonths(p.receivedOn, config.targetMonths) : null;
    const daysToTarget = targetOn ? Math.round((parseDay(targetOn) - today) / DAY) : null;
    const supplier = p.purchaseId ? input.suppliers?.get(p.purchaseId) : undefined;
    return {
      productId: p.productId, sku: p.sku, title: p.title, warehouseId: p.warehouseId, layerId: p.layerId, lot: p.lot, expiresOn: p.expiresOn,
      receivedOn: p.receivedOn, ageDays: known ? Math.round((today - parseDay(p.receivedOn)) / DAY) : null, targetOn, daysToTarget, status: statusFor(daysToTarget, config),
      onHand: p.onHand, reserved: p.reserved, available: p.available, unitCost: p.unitCost, costValue: p.unitCost === null ? null : round2(p.unitCost * p.onHand),
      leftoverAtTarget: null, expiresBeforeTarget: Boolean(p.expiresOn && targetOn && p.expiresOn < targetOn),
      ...(p.purchaseId ? { purchaseId: p.purchaseId } : {}), ...(supplier ?? {})
    };
  });
  // Proyección por SKU: se vende primero lo más antiguo; lo vendido antes del objetivo de cada capa se descuenta.
  const bySku = new Map<string, AgingLayer[]>();
  for (const layer of layers) bySku.set(key(layer), [...(bySku.get(key(layer)) ?? []), layer]);
  const slow: SlowProduct[] = [];
  for (const [k, group] of bySku) {
    const v = velocity(k);
    group.sort((a, b) => (a.receivedOn || "0000").localeCompare(b.receivedOn || "0000"));
    let ahead = 0;
    for (const layer of group) {
      if (v !== null && layer.daysToTarget !== null) {
        const sellable = v * Math.max(0, layer.daysToTarget);
        layer.leftoverAtTarget = Math.max(0, Math.min(layer.onHand, Math.round(ahead + layer.onHand - sellable)));
      }
      ahead += layer.onHand;
    }
    const onHand = group.reduce((s, l) => s + l.onHand, 0), sold = input.unitsSold.get(k) ?? 0, days = input.daysWithStock.get(k) ?? 0;
    const leftover = v === null ? null : group.reduce((s, l) => s + (l.leftoverAtTarget ?? 0), 0);
    const reason: SlowProduct["reason"] = v === null ? null : sold === 0 ? "SIN_VENTAS" : leftover ? "SOBRARAN" : null;
    const costs = group.map(l => l.costValue);
    slow.push({
      productId: group[0]!.productId, sku: group[0]!.sku, title: group[0]!.title, onHand, unitsSold: sold, daysWithStock: Math.round(days),
      dailyVelocity: v === null ? null : Math.round(v * 1000) / 1000, history: v === null ? "INSUFICIENTE" : "SUFICIENTE", reason, leftoverAtTarget: leftover,
      oldestReceivedOn: group.find(l => l.receivedOn)?.receivedOn ?? null, costValue: round2(costs.reduce<number>((s, c) => s + (c ?? 0), 0)), costComplete: costs.every(c => c !== null)
    });
  }
  const order: AgingStatus[] = ["OBJETIVO_ALCANZADO", "PRIORITARIO", "PREPARAR", "EN_PLAZO", "SIN_FECHA"];
  layers.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (a.daysToTarget ?? 1e9) - (b.daysToTarget ?? 1e9));
  const alerts = layers.filter(l => ["OBJETIVO_ALCANZADO", "PRIORITARIO", "PREPARAR"].includes(l.status));
  const slowList = slow.filter(s => s.reason).sort((a, b) => (b.leftoverAtTarget ?? 0) - (a.leftoverAtTarget ?? 0) || b.onHand - a.onHand);
  return {
    config, today: input.today, layers, slow: slowList, insufficientHistory: slow.filter(s => s.history === "INSUFICIENTE").length,
    summary: {
      byStatus: Object.fromEntries(order.map(s => [s, { layers: layers.filter(l => l.status === s).length, units: layers.filter(l => l.status === s).reduce((n, l) => n + l.onHand, 0) }])),
      toManage: { products: new Set(alerts.map(l => `${l.productId}:${l.sku}`)).size, units: alerts.reduce((n, l) => n + l.onHand, 0), costValue: round2(alerts.reduce((n, l) => n + (l.costValue ?? 0), 0)), costComplete: alerts.every(l => l.costValue !== null), nextTargetOn: alerts.map(l => l.targetOn).filter(Boolean).sort()[0] ?? null },
      expiresBeforeTarget: layers.filter(l => l.expiresBeforeTarget).length
    }
  };
}

/** Días con stock disponible por SKU dentro de la ventana, a partir del historial de movimientos. */
export function stockDays(movements: Array<{ productId: string; sku: string; after: number; createdAt: Date | string; sequence?: number }>, start: Date, end: Date) {
  const groups = new Map<string, typeof movements>();
  for (const m of movements) groups.set(`${m.productId}:${m.sku}`, [...(groups.get(`${m.productId}:${m.sku}`) ?? []), m]);
  const result = new Map<string, number>();
  for (const [k, rows] of groups) {
    rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || (a.sequence ?? 0) - (b.sequence ?? 0));
    let cursor = start.getTime(), balance = 0, inStock = 0;
    for (const row of rows) {
      const at = Math.max(start.getTime(), Math.min(end.getTime(), new Date(row.createdAt).getTime()));
      if (at > cursor && balance > 0) inStock += at - cursor;
      cursor = Math.max(cursor, at); balance = row.after;
    }
    if (balance > 0 && end.getTime() > cursor) inStock += end.getTime() - cursor;
    result.set(k, inStock / DAY);
  }
  return result;
}

// Carga de datos reales para el cálculo. Se importa aparte de la regla pura para poder probarla sin base.
import { supplyService } from "./supply.service.js";
import { orderService } from "./order.service.js";
import { movementHistory } from "./stockLedger.service.js";
import { commerceSettingsService } from "./commerceSettings.service.js";
import { saleStatuses } from "./management.service.js";
import { ecuadorToday } from "./inventoryPositions.js";

export const inventoryAgingService = {
  async overview(now = new Date()) {
    const settings = await commerceSettingsService.get();
    const config = { ...defaultAgingConfig, ...(settings.inventoryAging ?? {}) };
    const start = new Date(now.getTime() - config.windowDays * DAY);
    const [positions, orders, movements, purchases, suppliers] = await Promise.all([supplyService.positions(), orderService.forManagement(start, now), movementHistory(now, start), supplyService.purchases(), supplyService.suppliers()]);
    const unitsSold = new Map<string, number>();
    for (const order of orders as Array<{ status: string; createdAt: Date | string; items: Array<{ productId: string; variantSku: string; quantity: number }> }>) {
      const at = new Date(order.createdAt);
      if (!saleStatuses.has(order.status) || at < start || at > now) continue;
      for (const item of order.items) unitsSold.set(`${item.productId}:${item.variantSku}`, (unitsSold.get(`${item.productId}:${item.variantSku}`) ?? 0) + item.quantity);
    }
    const names = new Map(suppliers.map(s => [s.id, s.name]));
    const byPurchase = new Map(purchases.map(p => [p.id, { supplierId: p.supplierId, supplierName: names.get(p.supplierId) ?? "" }]));
    return computeAging({ positions, today: ecuadorToday(now), config, unitsSold, daysWithStock: stockDays(movements, start, now), suppliers: byPurchase });
  }
};
