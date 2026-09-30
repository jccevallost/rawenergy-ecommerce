// Genera docs/catalogo-inicial/catalogo-rawenergy.csv desde apps/api/src/data/initialCatalog.ts
// con el formato del importador del panel. Existencias en 0: el inventario real
// entra por Órdenes de compra. Uso: node --import tsx scripts/export-initial-catalog.mts
import { writeFile } from "node:fs/promises";
import { initialCatalog } from "../apps/api/src/data/initialCatalog.ts";
import { importColumns } from "../apps/admin/src/features/catalog/importProducts.ts";

const cell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const rows = initialCatalog.flatMap(product => product.variants.map(variant => {
  const facts = product.nutritionalFacts;
  const values: Record<string, unknown> = {
    identificador: product.slug, nombre: product.title, marca: product.brand, descripcion: product.shortDescription, tipo: product.productType,
    categorias: product.categories.map(item => item.name).join("|"), objetivos: product.goals.map(item => item.name).join("|"),
    sabor: variant.flavor, tamano: variant.size.value, unidad: variant.size.unit, sku: variant.sku, precio: variant.price.toFixed(2),
    stock: 0, minimo: variant.reorderPoint ?? 3, imagenes: "",
    porcion: facts?.servingSize ?? "", calorias: facts?.calories, proteina: facts?.protein, carbohidratos: facts?.carbohydrates, grasas: facts?.fats
  };
  return importColumns.map(column => cell(values[column])).join(",");
}));
await writeFile("docs/catalogo-inicial/catalogo-rawenergy.csv", `﻿${importColumns.join(",")}\n${rows.join("\n")}\n`);
console.log(`${initialCatalog.length} productos, ${rows.length} filas`);
