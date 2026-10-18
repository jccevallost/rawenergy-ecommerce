import { z } from "zod";
import { productService } from "./product.service.js";
import { supplyService } from "./supply.service.js";
import { movementHistory, type StockMovement } from "./stockLedger.service.js";
import { orderService } from "./order.service.js";
import { layerPositions, totalsBySku, type InventoryProduct, type ReservedLot } from "./inventoryPositions.js";
import { expenseService, type Expense } from "./expense.service.js";

const baseFilters = z.object({ year: z.number().int().min(2020).max(2100), month: z.number().int().min(0).max(12).default(0), category: z.string().max(120).default(""), dateBasis: z.enum(["CREATED", "PAID"]).default("CREATED"), coverageDays: z.number().int().min(1).max(365).default(30) });
// M17: período personalizado «desde–hasta» (fechas de Ecuador, ambos días incluidos), además de año y mes.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "Fecha no válida");
export const managementFilters = baseFilters.extend({ from: day.optional(), to: day.optional() })
  .refine(f => Boolean(f.from) === Boolean(f.to), "Indica las dos fechas del período.")
  .refine(f => !f.from || !f.to || (f.from <= f.to && (Date.parse(f.to) - Date.parse(f.from)) / 86400000 <= 731), "El período debe ir de una fecha a otra posterior, con un máximo de dos años.");
export type ManagementProduct = { id?: unknown; _id?: unknown; title: string; active?: boolean; categories: Array<{ slug: string; name: string }>; variants: Array<{ sku: string; stock: number; price: number; reorderPoint?: number; flavor: string; lots?: Array<{quantity:number;expiresOn?:string}> }> };
// Lo cobrado por la línea: con descuento de bienvenida (C46) se resta su parte.
const netLine = (item: { lineTotal: number; discount?: number | null }) => Math.round((item.lineTotal - (item.discount ?? 0)) * 100) / 100;
export type ManagementOrder = { createdAt: Date | string; paidAt?: Date | string | null; shippingFee?: number; status: string; returns?: Array<{ items: Array<{ variantSku: string; quantity: number }> }>; items: Array<{ productId: string; variantSku: string; title: string; quantity: number; lineTotal: number; discount?: number | null; unitCost?: number | null; categories?: Array<{ slug: string; name: string }> }> };
/** Estados que cuentan como venta en resultados y en la velocidad de venta (ROT-01). */
export const saleStatuses = new Set(["PAID", "PREPARING", "SHIPPED", "COMPLETED"]);
const paid = saleStatuses;
const round = (n: number) => Math.round(n * 100) / 100;
// Ecuador continental (UTC-5): midnight on Jan 1 is 05:00 UTC.
/** Rango efectivo del informe: el personalizado si existe; si no, el mes o el año. */
export function reportRange(f: { year: number; month: number; from?: string; to?: string }) {
  if (f.from && f.to) return { start: new Date(Date.parse(f.from) + 5 * 3600000), end: new Date(Date.parse(f.to) + 29 * 3600000) };
  return managementRange(f.year, f.month);
}
export function managementRange(year: number, month: number) {
  return { start: new Date(Date.UTC(year, month ? month - 1 : 0, 1, 5)), end: new Date(Date.UTC(year + (month ? 0 : 1), month || 0, 1, 5)) };
}
/** M43: una devolución parcial quita del pedido solo las unidades devueltas, con su parte del ingreso y del descuento. */
export function withoutReturns(order: ManagementOrder): ManagementOrder {
  if (!order.returns?.length) return order;
  const back = new Map<string, number>();
  for (const r of order.returns) for (const i of r.items) back.set(i.variantSku, (back.get(i.variantSku) ?? 0) + i.quantity);
  return { ...order, items: order.items.map(item => {
    const kept = item.quantity - Math.min(item.quantity, back.get(item.variantSku) ?? 0);
    if (kept === item.quantity) return item;
    const share = kept / item.quantity;
    return { ...item, quantity: kept, lineTotal: Math.round(item.lineTotal * share * 100) / 100, discount: item.discount == null ? item.discount : Math.round(item.discount * share * 100) / 100 };
  }).filter(item => item.quantity > 0) };
}
export function computeManagement(products: ManagementProduct[], rawOrders: ManagementOrder[], raw: unknown, now = new Date(), movements: StockMovement[] = [], incoming: Array<{ productId: string; sku: string; quantity: number; expectedOn?: string }> = [], reservations: ReservedLot[] = []) {
  const f = managementFilters.parse(raw);
  const orders = rawOrders.map(withoutReturns);
  const { start, end } = reportRange(f);
  const elapsedDays = Math.max(1, Math.ceil((Math.min(end.getTime(), now.getTime()) - start.getTime()) / 86400000));
  const productMap = new Map(products.map((p) => [String(p.id ?? p._id), p]));
  const sales = new Map<string, { productId: string; title: string; units: number; revenue: number; cost: number; coveredRevenue: number; knownUnits: number }>();
  const bySku = new Map<string, number>();
  const categories = new Map<string, { key: string; name: string; units: number; revenue: number }>();
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, units: 0, revenue: 0, coveredRevenue: 0, cost: 0, knownUnits: 0, shippingRevenue: 0 }));
  let orderCount = 0, knownRevenue = 0, knownCost = 0, knownUnits = 0;
  for (const order of orders) {
    const date = new Date(f.dateBasis === "PAID" ? order.paidAt ?? NaN : order.createdAt);
    if (!Number.isFinite(date.getTime())) continue;
    if (!paid.has(order.status) || date < start || date >= end || date > now) continue;
    let included = false;
    for (const item of order.items) {
      const product = productMap.get(item.productId);
      const refs = item.categories?.length ? item.categories : product?.categories ?? [];
      if (f.category && !refs.some((c) => c.slug === f.category)) continue;
      included = true;
      if (typeof item.unitCost === "number" && Number.isFinite(item.unitCost)) { knownRevenue += netLine(item); knownCost += item.unitCost * item.quantity; knownUnits += item.quantity; }
      const row = sales.get(item.productId) ?? { productId: item.productId, title: item.title, units: 0, revenue: 0, cost: 0, coveredRevenue: 0, knownUnits: 0 };
      row.units += item.quantity; row.revenue = round(row.revenue + netLine(item)); sales.set(item.productId, row);
      const skuKey = `${item.productId}:${item.variantSku}`;
      bySku.set(skuKey, (bySku.get(skuKey) ?? 0) + item.quantity);
      const bucket = months[new Date(date.getTime() - 5 * 3600000).getUTCMonth()]!;
      bucket.units += item.quantity; bucket.revenue = round(bucket.revenue + netLine(item));
      if (typeof item.unitCost === "number" && Number.isFinite(item.unitCost)) {
        row.cost += item.unitCost * item.quantity; row.coveredRevenue += netLine(item); row.knownUnits += item.quantity;
        bucket.cost += item.unitCost * item.quantity; bucket.coveredRevenue += netLine(item); bucket.knownUnits += item.quantity;
      }
      // Multi-category products appear in every category; category totals are not additive.
      for (const category of refs.length ? refs : [{ slug: "uncategorized", name: "Sin categoría" }]) {
        const group = categories.get(category.slug) ?? { key: category.slug, name: category.name, units: 0, revenue: 0 };
        group.units += item.quantity; group.revenue = round(group.revenue + netLine(item)); categories.set(category.slug, group);
      }
    }
    if (included) {
      orderCount++;
      if (!f.category) months[new Date(date.getTime() - 5 * 3600000).getUTCMonth()]!.shippingRevenue += order.shippingFee ?? 0;
    }
  }
  const movementGroups = new Map<string, StockMovement[]>();
  for(const movement of movements) { const key=JSON.stringify([movement.productId,movement.sku]); const rows=movementGroups.get(key)??[];rows.push(movement);movementGroups.set(key,rows); }
  const transitGroups = new Map<string, {all:number;due:number}>();
  const today = new Date(now.getTime()-5*3600000).toISOString().slice(0,10);
  const horizon = new Date(now.getTime()+f.coverageDays*86400000-5*3600000).toISOString().slice(0,10);
  for(const item of incoming) { const key=JSON.stringify([item.productId,item.sku]);const row=transitGroups.get(key)??{all:0,due:0};row.all+=item.quantity;if(item.expectedOn&&item.expectedOn>=today&&item.expectedOn<=horizon)row.due+=item.quantity;transitGroups.set(key,row); }
  const stockTotals = totalsBySku(layerPositions(products as unknown as InventoryProduct[], reservations, new Date(now.getTime()-5*3600000).toISOString().slice(0,10)));
  const inventory = products.filter((p) => p.active !== false && (!f.category || p.categories.some((c) => c.slug === f.category))).flatMap((p) => p.variants.map((v) => {
    const productId = String(p.id ?? p._id);
    const units = bySku.get(`${productId}:${v.sku}`) ?? 0;
    const dailyUnits = units / elapsedDays;
    const reorderPoint = v.reorderPoint ?? 5;
    const today = new Date(now.getTime()-5*3600000).toISOString().slice(0,10);
    // M41: misma regla que el panel de bodegas. Vencidas = físicas vencidas; disponibles = vendibles sin reservar.
    const totals=stockTotals.get(`${productId}:${v.sku}`)??{onHand:0,reserved:0,available:0,sellable:0,expired:0,costValue:0,costComplete:true};
    const expiredStock=totals.expired, availableStock=totals.sellable, physicalStock=totals.onHand, reservedStock=totals.reserved;
    const transit = transitGroups.get(JSON.stringify([productId,v.sku]))??{all:0,due:0};
    const inTransit = transit.all, arrivingInTime = transit.due;
    const suggestedOrder = Math.max(0, Math.ceil(dailyUnits * f.coverageDays) - availableStock - arrivingInTime, reorderPoint - availableStock - arrivingInTime);
    const history = (movementGroups.get(JSON.stringify([productId,v.sku]))??[]).sort((a,b) => new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime() || (a.sequence ?? 0)-(b.sequence ?? 0));
    const completeHistory = Boolean(history[0] && (new Date(history[0].createdAt) <= start || history[0].reason === "Stock inicial de producto"));
    const until = Math.min(now.getTime(),end.getTime()); let cursor=start.getTime(), balance=history[0]?.before ?? 0, area=0;
    for (const movement of history) { const at=new Date(movement.createdAt).getTime(); if(at>until) break; if(at<cursor) {balance=movement.after;continue;} area+=balance*(at-cursor);balance=movement.after;cursor=at; }
    area+=balance*Math.max(0,until-cursor);const averageStock=completeHistory && until>start.getTime() ? area/(until-start.getTime()) : null;
    return { productId, title: p.title, sku: v.sku, flavor: v.flavor, stock: v.stock, availableStock, expiredStock, physicalStock, reservedStock, costValue: totals.costValue, costComplete: totals.costComplete, reorderPoint, units, dailyUnits: round(dailyUnits), coverage: dailyUnits ? round(availableStock / dailyUnits) : null, suggestedOrder, inTransit, arrivingInTime, averageStock: averageStock === null ? null : round(averageStock), turnover: averageStock && averageStock > 0 ? round(units/averageStock) : null, historyComplete: completeHistory, low: availableStock <= reorderPoint, stockValue: round(v.stock * v.price) };
  })).sort((a, b) => Number(b.low) - Number(a.low) || b.suggestedOrder - a.suggestedOrder || a.stock - b.stock);
  const withMargin = <T extends { cost: number; coveredRevenue: number; knownUnits: number; revenue: number; units: number }>(row: T) => ({ ...row, cost: round(row.cost), coveredRevenue: round(row.coveredRevenue), grossProfit: row.knownUnits ? round(row.coveredRevenue - row.cost) : null, costComplete: row.knownUnits === row.units, coveragePercent: row.revenue ? round(row.coveredRevenue / row.revenue * 100) : 0 });
  const ranking = [...sales.values()].map(withMargin).sort((a, b) => b.units - a.units || b.revenue - a.revenue);
  const revenue = round(ranking.reduce((s, p) => s + p.revenue, 0));
  return { filters: f, elapsedDays, revenue, knownUnits, margin: { coveredRevenue: round(knownRevenue), cost: round(knownCost), grossProfit: knownUnits ? round(knownRevenue-knownCost) : null, percent: knownRevenue ? round((knownRevenue-knownCost)/knownRevenue*100) : null, coveragePercent: revenue ? round(knownRevenue/revenue*100) : 0, unknownUnits: ranking.reduce((s, p) => s + p.units, 0) - knownUnits }, units: ranking.reduce((s, p) => s + p.units, 0), orderCount, averageTicket: orderCount ? round(revenue / orderCount) : 0, ranking, months: months.map(withMargin), categories: [...categories.values()].sort((a, b) => b.units - a.units), inventory, lowStock: inventory.filter((v) => v.low).length, outOfStock: inventory.filter((v) => !v.availableStock).length, noSales: inventory.filter((v) => !v.units).length, stockValue: round(inventory.reduce((s, v) => s + v.stockValue, 0)), stockCostValue: round(inventory.reduce((s, v) => s + v.costValue, 0)), stockCostComplete: inventory.every(v => v.costComplete) };
}
export function financialSummary(report: ReturnType<typeof computeManagement>, expenses: Pick<Expense, "date" | "amount" | "category" | "status">[]) {
  const { from, to } = report.filters;
  const prefix = `${report.filters.year}${report.filters.month ? `-${String(report.filters.month).padStart(2, "0")}` : ""}`;
  const rows = expenses.filter(e => e.status === "ACTIVE" && (from && to ? e.date >= from && e.date <= to : e.date.startsWith(prefix)));
  const byCategory = new Map<string, number>();
  for (const expense of rows) byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + expense.amount);
  const expenseTotal = round(rows.reduce((s, e) => s + e.amount, 0));
  const shippingRevenue = round(report.months.reduce((s, m) => s + m.shippingRevenue, 0));
  const completeCosts = report.margin.unknownUnits === 0;
  const result = completeCosts && !report.filters.category ? round(report.revenue + shippingRevenue - report.margin.cost - expenseTotal) : null;
  return { expenseTotal, expenseCount: rows.length, shippingRevenue, result, completeCosts, categoryFiltered: Boolean(report.filters.category), expenseCategories: [...byCategory].map(([category, amount]) => ({ category, amount: round(amount) })).sort((a, b) => b.amount - a.amount) };
}
export const managementService = {
  async dashboard(raw: unknown) {
    const f = managementFilters.parse(raw);
    const now=new Date();
    const range = reportRange(f), custom = Boolean(f.from && f.to), calendar = { ...f, from: undefined, to: undefined };
    const loadStart = new Date(Math.min(range.start.getTime(), managementRange(f.year-1,0).start.getTime())), loadEnd = new Date(Math.max(range.end.getTime(), managementRange(f.year,0).end.getTime()));
    const expenseFrom = custom && f.from! < `${f.year}-01-01` ? f.from! : `${f.year}-01-01`, expenseTo = custom && f.to! >= `${f.year+1}-01-01` ? new Date(Date.parse(f.to!) + 86400000).toISOString().slice(0, 10) : `${f.year+1}-01-01`;
    const [products, orders, movements, purchases, expenses, reservations] = await Promise.all([productService.allForManagement(), orderService.forManagement(loadStart, loadEnd), movementHistory(new Date(Math.min(now.getTime(),range.end.getTime())),range.start), supplyService.inTransit(), expenseService.forPeriod(expenseFrom, expenseTo), orderService.reservedPositions()]);
    const incoming=purchases.flatMap(p=>p.items.map(item=>({...item,expectedOn:p.expectedOn})));
    const result=computeManagement(products as ManagementProduct[],orders as ManagementOrder[],f,now,movements,incoming,reservations as unknown as ReservedLot[]);
    const annual=computeManagement(products as ManagementProduct[],orders as ManagementOrder[],{...calendar,month:0},now);
    // Las comparaciones solo tienen sentido entre meses o años completos.
    const previousYear=custom ? null : computeManagement(products as ManagementProduct[],orders as ManagementOrder[],{...calendar,year:f.year-1}, comparisonEnd(f.year,f.month,f.year-1,f.month,now));
    const previousMonth=f.month && !custom ? computeManagement(products as ManagementProduct[],orders as ManagementOrder[],{...calendar,year:f.month===1?f.year-1:f.year,month:f.month===1?12:f.month-1},comparisonEnd(f.year,f.month,f.month===1?f.year-1:f.year,f.month===1?12:f.month-1,now)) : null;
    const compare=(prior:typeof previousYear|null)=>prior?{revenue:prior.revenue,units:prior.units,orders:prior.orderCount,revenueChange:prior.revenue ? round((result.revenue-prior.revenue)/prior.revenue*100) : null}:null;
    const months = annual.months.map(m => {
      const expenseTotal = round(expenses.filter(e => Number(e.date.slice(5, 7)) === m.month).reduce((s, e) => s + e.amount, 0));
      return { ...m, expenseTotal, result: m.costComplete && !f.category ? round(m.revenue + m.shippingRevenue - m.cost - expenseTotal) : null };
    });
    return {...result, financial: financialSummary(result, expenses), months, updatedAt: now.toISOString(), comparison:{previousYear:compare(previousYear),previousMonth:compare(previousMonth)}};
  },
  async inventory(raw: unknown) {
    const f=managementFilters.parse(raw), now=new Date(), range=reportRange(f);
    const [products,orders,movements,purchases,reservations]=await Promise.all([productService.allForManagement(),orderService.forManagement(range.start,range.end),movementHistory(new Date(Math.min(now.getTime(),range.end.getTime())),range.start),supplyService.inTransit(),orderService.reservedPositions()]);
    const data=computeManagement(products as ManagementProduct[],orders as ManagementOrder[],f,now,movements,purchases.flatMap(p=>p.items.map(item=>({...item,expectedOn:p.expectedOn}))),reservations as unknown as ReservedLot[]);
    return { inventory:data.inventory,lowStock:data.lowStock,outOfStock:data.outOfStock,noSales:data.noSales,elapsedDays:data.elapsedDays,stockValue:data.stockValue,stockCostValue:data.stockCostValue,stockCostComplete:data.stockCostComplete };
  }
};
function comparisonEnd(year:number,month:number,priorYear:number,priorMonth:number,now:Date) {
 const current=managementRange(year,month),prior=managementRange(priorYear,priorMonth);
 return new Date(Math.min(prior.end.getTime(),prior.start.getTime()+Math.max(0,Math.min(now.getTime(),current.end.getTime())-current.start.getTime())));
}
