// RES-01: margen por orden de compra con origen de las unidades, devoluciones, cambios y remanente.
import { describe, expect, it } from "vitest";
import { computePurchaseResults } from "./purchaseResults.service.js";
import { computeManagement, reportRange } from "./management.service.js";

const lot = (purchaseId: string | undefined, quantity: number, unitCost: number | null, layerId: string) => ({ warehouseId: "main", lot: "L", expiresOn: "", quantity, unitCost, layerId, ...(purchaseId ? { purchaseId } : {}) });

describe("Resultados por compra (RES-01)", () => {
  it("atribuye ingreso y costo a cada compra, resta devoluciones y separa lo sin origen", () => {
    const result = computePurchaseResults({
      purchases: [
        { id: "A", number: "OC-A", supplierId: "s", status: "RECEIVED", total: 100, receivedOn: "2026-08-01", items: [{ quantity: 5 }], document: { number: "001-001-000000001" } },
        { id: "B", number: "OC-B", supplierId: "s", status: "RECEIVED", total: 60, receivedOn: "2026-09-01", items: [{ quantity: 3 }] },
        { id: "C", number: "OC-C", supplierId: "s", status: "ORDERED", total: 10, items: [{ quantity: 1 }] }
      ],
      suppliers: [{ id: "s", name: "FITLAB" }],
      orders: [
        { status: "COMPLETED", createdAt: "2026-09-10", items: [{ productId: "p", variantSku: "S", quantity: 4, lineTotal: 120, discount: 0, allocations: [lot("A", 3, 20, "LA"), lot("B", 1, 20, "LB")] }], returns: [{ items: [{ variantSku: "S", allocations: [lot("B", 1, 20, "LB")] }] }] },
        { status: "PAID", createdAt: "2026-09-12", items: [{ productId: "p", variantSku: "S", quantity: 2, lineTotal: 50, allocations: [lot(undefined, 2, null, "L-legacy")] }] },
        { status: "CANCELLED", createdAt: "2026-09-12", items: [{ productId: "p", variantSku: "S", quantity: 9, lineTotal: 999, allocations: [lot("A", 9, 20, "LA")] }] }
      ],
      positions: [{ purchaseId: "A", onHand: 1, unitCost: 20 }, { purchaseId: "B", onHand: 3, unitCost: 20 }],
      exchanges: [{ status: "ABIERTO", items: [{ quantity: 1, lot: lot("A", 1, 20, "LA") }] }, { status: "ANULADO", items: [{ quantity: 5, lot: lot("A", 5, 20, "LA") }] }]
    });
    expect(result.purchases.map(p => p.number)).toEqual(["OC-B", "OC-A"]);
    expect(result.purchases.find(p => p.purchaseId === "A")).toMatchObject({ unitsReceived: 5, unitsSold: 3, unitsReturned: 0, unitsExchanged: 1, unitsRemaining: 1, revenue: 90, costSold: 60, grossProfit: 30, remainingCostValue: 20, recoveredPercent: 90, supplierName: "FITLAB" });
    expect(result.purchases.find(p => p.purchaseId === "B")).toMatchObject({ unitsSold: 0, unitsReturned: 1, revenue: 0, costSold: 0, unitsRemaining: 3 });
    expect(result.unattributed).toEqual({ units: 2, revenue: 50 });
  });
});

describe("Período personalizado (M17)", () => {
  it("usa fechas de Ecuador con ambos días incluidos y rechaza rangos inválidos", () => {
    expect(reportRange({ year: 2026, month: 0, from: "2026-09-05", to: "2026-09-06" })).toEqual({ start: new Date("2026-09-05T05:00:00Z"), end: new Date("2026-09-07T05:00:00Z") });
    const order = (createdAt: string) => ({ createdAt, status: "PAID", shippingFee: 0, items: [{ productId: "p", variantSku: "S", title: "P", quantity: 1, lineTotal: 10, unitCost: 4 }] });
    const products = [{ id: "p", title: "P", categories: [], variants: [{ sku: "S", stock: 0, price: 10, flavor: "x" }] }];
    const report = computeManagement(products, [order("2026-09-05T05:00:00Z"), order("2026-09-07T04:59:59Z"), order("2026-09-07T05:00:00Z"), order("2026-09-05T04:59:59Z")], { year: 2026, from: "2026-09-05", to: "2026-09-06" }, new Date("2026-10-01T05:00:00Z"));
    expect(report.units).toBe(2);
    expect(() => computeManagement(products, [], { year: 2026, from: "2026-09-06", to: "2026-09-05" })).toThrow();
    expect(() => computeManagement(products, [], { year: 2026, from: "2026-09-06" })).toThrow();
  });
});
