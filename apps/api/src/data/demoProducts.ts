import type { ProductPayload } from "../validation/product.js";
import { initialCatalog } from "./initialCatalog.js";

// Catálogo de la demo en memoria (desarrollo y pruebas). Es el catálogo inicial
// real con existencias ficticias; nunca se usa en producción (el servidor no
// arranca en modo demo con NODE_ENV=production o MONGODB_URI definido).
export const demoProducts: ProductPayload[] = initialCatalog;
