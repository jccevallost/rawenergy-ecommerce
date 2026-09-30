export const roles = ["CUSTOMER", "CATALOG", "WAREHOUSE", "MANAGER", "ADMIN"] as const;
export type Role = typeof roles[number];
export type Permission = "catalog.read" | "catalog.write" | "inventory.read" | "inventory.write" | "orders.read" | "orders.write" | "purchases.read" | "purchases.write" | "management.read" | "audit.read" | "system.manage";
export const permissions: Record<Role, Permission[]> = {
  CUSTOMER: [],
  CATALOG: ["catalog.read", "catalog.write"],
  WAREHOUSE: ["catalog.read", "inventory.read", "inventory.write", "orders.read", "orders.write", "purchases.read", "purchases.write"],
  MANAGER: ["catalog.read", "inventory.read", "orders.read", "purchases.read", "management.read", "audit.read"],
  ADMIN: ["catalog.read", "catalog.write", "inventory.read", "inventory.write", "orders.read", "orders.write", "purchases.read", "purchases.write", "management.read", "audit.read", "system.manage"]
};
