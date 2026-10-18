export const roles = ["CUSTOMER", "CATALOG", "WAREHOUSE", "MANAGER", "STORE_MANAGER", "ADMIN"] as const;
export type Role = typeof roles[number];
export type Permission = "catalog.read" | "catalog.write" | "inventory.read" | "inventory.write" | "orders.read" | "orders.write" | "purchases.read" | "purchases.write" | "management.read" | "audit.read" | "expenses.write" | "system.manage";
export const permissions: Record<Role, Permission[]> = {
  CUSTOMER: [],
  CATALOG: ["catalog.read", "catalog.write"],
  WAREHOUSE: ["catalog.read", "inventory.read", "inventory.write", "orders.read", "orders.write", "purchases.read", "purchases.write"],
  MANAGER: ["catalog.read", "inventory.read", "orders.read", "purchases.read", "management.read", "audit.read"],
  // ROL-01, decisión del propietario del 14/10/2026: jefe de tienda de confianza. Catálogo, precios y campañas,
  // inventario, pedidos, compras, resultados, auditoría y registro de gastos. Sin usuarios, seguridad ni
  // configuración global (system.manage); anular gastos y unir productos siguen siendo de Administración.
  STORE_MANAGER: ["catalog.read", "catalog.write", "inventory.read", "inventory.write", "orders.read", "orders.write", "purchases.read", "purchases.write", "management.read", "audit.read", "expenses.write"],
  ADMIN: ["catalog.read", "catalog.write", "inventory.read", "inventory.write", "orders.read", "orders.write", "purchases.read", "purchases.write", "management.read", "audit.read", "expenses.write", "system.manage"]
};
