// M41: única regla de servidor para contar unidades por capa de inventario.
//
// En la variante, `stock` y `lots` guardan lo que está en estantería SIN reservar: reservar un
// pedido descuenta esas unidades y las guarda en las asignaciones del pedido. Por eso las
// unidades físicas de una capa son las de su lote más las reservadas por pedidos activos.
//
//   onHand (físicas) = available (sin reservar) + reserved (reservadas)
//   sellable (vendibles) = available si la capa no está vencida; 0 si lo está
//
// Panel de bodegas, dashboard, antigüedad y cambios deben usar estas funciones, no `variant.stock`.
import { normalizedLots, withLayer, type StockLayerSource, type StockLot } from "./stockLedger.service.js";

export type InventoryProduct = { id?: unknown; _id?: unknown; title: string; variants: Array<{ sku: string; stock: number; lots?: unknown }> };
export type ReservedLot = { productId: string; sku: string; title?: string; warehouseId?: string | null; lot?: string | null; expiresOn?: string | null; unitCost?: number | null; quantity?: number | null; layerId?: string | null; receivedOn?: string | null; source?: string | null; purchaseId?: string | null; purchaseLine?: number | null };
export type LayerPosition = Omit<StockLot, "layerId" | "receivedOn" | "source"> & {
  productId: string; sku: string; title: string; layerId: string; receivedOn: string; source: StockLayerSource;
  /** Igual a `available`; se conserva por compatibilidad con el panel actual. */
  quantity: number; available: number; reserved: number; onHand: number; sellable: number; expired: boolean;
};
/** M44: costValue es el valor a costo con IVA de las unidades físicas con costo conocido; costComplete indica si todas lo tienen. */
export type SkuTotals = { onHand: number; reserved: number; available: number; sellable: number; expired: number; costValue: number; costComplete: boolean };

export const ecuadorToday = (now = new Date()) => new Date(now.getTime() - 5 * 3600000).toISOString().slice(0, 10);
const productKey = (p: InventoryProduct) => String(p.id ?? p._id);
const positionKey = (productId: string, sku: string, warehouseId: string, layerId: string) => JSON.stringify([productId, sku, warehouseId, layerId]);

export function layerPositions(products: InventoryProduct[], reservations: ReservedLot[], today = ecuadorToday()): LayerPosition[] {
  const positions = new Map<string, LayerPosition>();
  const titles = new Map<string, string>();
  const add = (productId: string, sku: string, title: string, raw: ReservedLot | StockLot, available: number, reserved: number) => {
    const lot = withLayer({ ...raw, lot: raw.lot ?? "INICIAL", expiresOn: raw.expiresOn ?? "", unitCost: raw.unitCost ?? null });
    const warehouseId = raw.warehouseId ?? "main";
    const key = positionKey(productId, sku, warehouseId, lot.layerId);
    const row = positions.get(key) ?? {
      productId, sku, title, warehouseId, lot: lot.lot, expiresOn: lot.expiresOn ?? "", unitCost: lot.unitCost ?? null,
      layerId: lot.layerId, receivedOn: lot.receivedOn, source: lot.source,
      ...(lot.purchaseId ? { purchaseId: lot.purchaseId } : {}), ...(typeof lot.purchaseLine === "number" ? { purchaseLine: lot.purchaseLine } : {}),
      quantity: 0, available: 0, reserved: 0, onHand: 0, sellable: 0, expired: Boolean(lot.expiresOn && lot.expiresOn < today)
    };
    row.available += available; row.reserved += reserved;
    row.quantity = row.available; row.onHand = row.available + row.reserved; row.sellable = row.expired ? 0 : row.available;
    positions.set(key, row);
  };
  for (const product of products) {
    const productId = productKey(product);
    for (const variant of product.variants) {
      titles.set(`${productId}:${variant.sku}`, product.title);
      for (const lot of normalizedLots(variant as { stock: number; lots?: StockLot[] })) add(productId, variant.sku, product.title, lot, lot.quantity, 0);
    }
  }
  for (const reservation of reservations) add(reservation.productId, reservation.sku, reservation.title ?? titles.get(`${reservation.productId}:${reservation.sku}`) ?? "", reservation, 0, reservation.quantity ?? 0);
  return [...positions.values()];
}

export function totalsBySku(positions: LayerPosition[]): Map<string, SkuTotals> {
  const totals = new Map<string, SkuTotals>();
  for (const p of positions) {
    const key = `${p.productId}:${p.sku}`, row = totals.get(key) ?? { onHand: 0, reserved: 0, available: 0, sellable: 0, expired: 0, costValue: 0, costComplete: true };
    row.onHand += p.onHand; row.reserved += p.reserved; row.available += p.available; row.sellable += p.sellable; if (p.expired) row.expired += p.onHand;
    if (p.onHand > 0) { if (p.unitCost === null) row.costComplete = false; else row.costValue = Math.round((row.costValue + p.unitCost * p.onHand) * 100) / 100; }
    totals.set(key, row);
  }
  return totals;
}
