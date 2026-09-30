export type MarginRow = { revenue: number; units: number; cost: number; coveredRevenue: number; knownUnits: number; grossProfit: number | null; costComplete: boolean; coveragePercent: number };
export type MonthRow = MarginRow & { month: number; shippingRevenue: number; expenseTotal: number; result: number | null };
export type BusinessData = {
  revenue: number; units: number; orderCount: number; averageTicket: number;
  lowStock: number; outOfStock: number; noSales: number;
  margin: { cost: number; coveredRevenue: number; grossProfit: number | null; coveragePercent: number; unknownUnits: number };
  financial: { expenseTotal: number; expenseCount: number; shippingRevenue: number; result: number | null; completeCosts: boolean; categoryFiltered: boolean; expenseCategories: Array<{ category: string; amount: number }> };
  comparison: { previousMonth: { revenueChange: number | null } | null; previousYear: { revenueChange: number | null } | null };
  months: MonthRow[]; ranking: Array<MarginRow & { productId: string; title: string }>;
  categories: Array<{ key: string; name: string; revenue: number; units: number }>;
  inventory: Array<{ productId: string; title: string; sku: string; availableStock: number; stock: number; low: boolean; suggestedOrder: number; units: number }>;
  updatedAt: string;
};
type StockAmount = { units: number; knownValue: number; unknownUnits: number };
export type OperationsData = {
  orders: Array<{ status: string; count: number; amount: number }>;
  stock: StockAmount & { reserved: number; expired: StockAmount; expiring: StockAmount; riskLots: number; risks: Array<{ productId: string; title: string; sku: string; lot: string; expiresOn: string; onHand: number }> };
  purchases: { count: number; amount: number; overdue: number; rows: Array<{ id: string; number: string; total: number; expectedOn: string; supplier: string }> };
  updatedAt: string;
};
export const expenseLabels: Record<string, string> = { ADVERTISING: "Publicidad", PAYROLL: "Sueldos y honorarios", TRANSPORT: "Transporte y entregas", RENT: "Arriendo", UTILITIES: "Servicios", FEES: "Comisiones", INVENTORY_LOSS: "Mermas y pérdidas", OTHER: "Otros gastos" };
export const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const localToday = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
