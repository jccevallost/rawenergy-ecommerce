import { z } from "zod";
import { operationContext, unitOfWork } from "../lib/unitOfWork.js";
import { campaignService } from "./campaign.service.js";
import { orderService } from "./order.service.js";
import { productService } from "./product.service.js";

// Unión de productos (C49): mismo producto en otro tamaño cargado como ficha aparte
// (p. ej. la creatina de 1 kg). En una transacción: presentaciones al destino, líneas
// de pedidos y campañas al destino, y el origen archivado.
const mergeSchema = z.object({
  sourceId: z.string().trim().min(1).max(80),
  targetId: z.string().trim().min(1).max(80),
  flavors: z.record(z.string().trim().min(1).max(80), z.string().trim().min(1).max(60)).default({}),
  sourceRevision: z.number().int().nonnegative().optional(),
  targetRevision: z.number().int().nonnegative().optional()
}).strict();

export async function mergeProducts(raw: unknown): Promise<{ product: unknown; movedSkus: string[]; orders: number }> {
  if (!operationContext.getStore()) return unitOfWork(() => mergeProducts(raw));
  const input = mergeSchema.parse(raw);
  const { product, movedSkus } = await productService.absorbVariants(input.sourceId, input.targetId, input.flavors, { source: input.sourceRevision, target: input.targetRevision });
  const orders = await orderService.reassignProduct(input.sourceId, input.targetId);
  await campaignService.replaceProduct(input.sourceId, input.targetId);
  return { product, movedSkus, orders };
}
