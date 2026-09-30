import { describe, expect, it } from "vitest";
import { computeManagement, managementRange, type ManagementProduct, type ManagementOrder } from "./management.service.js";
import type { StockMovement } from "./stockLedger.service.js";
const products: ManagementProduct[] = [{ id: "p1", title: "Creatina", active: true, categories: [{ name: "Actual", slug: "actual" }], variants: [{ sku: "SKU-1", stock: 2, price: 10, flavor: "Natural", reorderPoint: 5 }] }];
const order = (date: string, status = "PAID", quantity = 3): ManagementOrder => ({ createdAt: date, status, items: [{ productId: "p1", variantSku: "SKU-1", title: "Creatina", quantity, lineTotal: quantity * 10, categories: [{ name: "Histórica", slug: "historica" }] }] });
describe("Gerencia: límites y significado de indicadores", () => {
  it("descuenta compras en tránsito y calcula margen solo con costos conocidos",()=>{
    const known=order("2026-09-01T05:00:00Z","PAID",10);known.items[0]!.unitCost=6;
    const report=computeManagement(products,[known,order("2026-09-03T05:00:00Z","PAID",10)],{year:2026,month:9,coverageDays:30},new Date("2026-09-11T05:00:00Z"),[],[{productId:"p1",sku:"SKU-1",quantity:20,expectedOn:"2026-09-15"}]);
    expect(report.inventory[0]?.suggestedOrder).toBe(38);expect(report.inventory[0]?.turnover).toBeNull();expect(report.margin).toMatchObject({grossProfit:40,percent:40,coveragePercent:50});
  });
  it("usa la fecha de pago elegida y excluye pedidos sin fecha histórica",()=>{
    const paid=order("2026-08-31T05:00:00Z");paid.paidAt="2026-09-05T05:00:00Z";
    const result=computeManagement(products,[paid,order("2026-09-02T05:00:00Z")],{year:2026,month:9,dateBasis:"PAID"},new Date("2026-09-11T05:00:00Z"));expect(result.units).toBe(3);
  });
  it("pondera el stock por tiempo y no inventa rotación sin historial suficiente",()=>{
    const history=[{productId:"p1",sku:"SKU-1",createdAt:new Date("2026-08-01T05:00:00Z"),before:0,after:10,reason:"Stock inicial de producto",sequence:1},{productId:"p1",sku:"SKU-1",createdAt:new Date("2026-09-06T05:00:00Z"),before:10,after:2,reason:"Reserva de pedido",sequence:2}] as StockMovement[];
    const result=computeManagement(products,[order("2026-09-06T05:00:00Z","PAID",8)],{year:2026,month:9},new Date("2026-09-11T05:00:00Z"),history);expect(result.inventory[0]).toMatchObject({averageStock:6,turnover:1.33,historyComplete:true});
    const partial=computeManagement(products,[],{year:2026,month:9},new Date("2026-09-11T05:00:00Z"),history.slice(1));expect(partial.inventory[0]?.turnover).toBeNull();
  });
  it("respeta medianoche de Ecuador y excluye pendientes/cancelados y meses ajenos", () => {
    const result = computeManagement(products, [order("2026-09-01T04:59:59Z"), order("2026-09-01T05:00:00Z"), order("2026-09-04T05:00:00Z", "CANCELLED"), order("2026-09-04T05:00:00Z", "PENDING_PAYMENT"), order("2026-10-01T05:00:00Z")], { year: 2026, month: 9 }, new Date("2026-10-02"));
    expect(result.units).toBe(3); expect(result.revenue).toBe(30); expect(result.orderCount).toBe(1); expect(result.months[8]?.revenue).toBe(30); expect(result.elapsedDays).toBe(30);
    expect(managementRange(2026, 12).end.toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });
  it("usa categoría de la compra incluso si se reclasificó el producto", () => {
    const report = computeManagement(products, [order("2026-09-01T05:00:00Z")], { year: 2026, month: 9, category: "historica" }, new Date("2026-09-11T05:00:00Z"));
    expect(report.units).toBe(3); expect(report.categories[0]?.name).toBe("Histórica");
  });
  it("calcula cobertura y reposición usando días transcurridos, incluyendo variantes sin ventas", () => {
    const result = computeManagement(products, [order("2026-09-01T05:00:00Z", "PAID", 20)], { year: 2026, month: 9, coverageDays: 30 }, new Date("2026-09-11T05:00:00Z"));
    expect(result.inventory[0]).toMatchObject({ dailyUnits: 2, coverage: 1, suggestedOrder: 58, low: true });
    const empty = computeManagement(products, [], { year: 2026, month: 9 });
    expect(empty.averageTicket).toBe(0); expect(empty.inventory[0]?.coverage).toBeNull(); expect(empty.noSales).toBe(1); expect(empty.inventory[0]?.suggestedOrder).toBe(3);
  });
  it("incluye productos archivados vendidos en el ranking pero no en existencias", () => {
    const result = computeManagement([{ ...products[0]!, active: false }], [order("2026-09-01T05:00:00Z")], { year: 2026, month: 0 }, new Date("2026-10-01"));
    expect(result.ranking).toHaveLength(1); expect(result.inventory).toHaveLength(0);
  });
});
