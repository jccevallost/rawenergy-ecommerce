import { createHash } from "node:crypto";
import sharp from "sharp";
import { ProductModel } from "../models/Product.js";
import { OrderModel } from "../models/Order.js";
import { productService } from "./product.service.js";
import { orderService } from "./order.service.js";
import mongoose from "mongoose";
import { MediaModel } from "../models/Media.js";

/** Formatos que aceptamos subir. No se confia en la extension del archivo. */
const allowedTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/tiff": "tiff"
};

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

/** Error de la foto que se puede mostrar tal cual; los de la librería de imágenes no (C60, S20). */
export class MediaInputError extends Error {}

export type MediaSize = "full" | "medium" | "thumb";
type StoredMedia = { contentType: string; size: number; data: Buffer; thumbnail?: Buffer; medium?: Buffer; width?: number; height?: number; label?: string; createdAt?: string };

class MediaService {
  private memory = new Map<string, StoredMedia>();
  private get useMongo() {
    return mongoose.connection.readyState === 1;
  }

  isAllowed(contentType?: string) {
    return Boolean(contentType && contentType in allowedTypes);
  }

  get allowedList() {
    return Object.keys(allowedTypes);
  }

  /**
   * Guarda el binario fuera del producto. Antes las fotos viajaban como data URI
   * dentro del documento: un producto con varias fotos reales superaba el limite
   * de 16 MB de MongoDB y cada consulta del catalogo arrastraba esos bytes.
   */
  async save(data: Buffer, contentType: string) {
    if (!this.isAllowed(contentType)) throw new MediaInputError(`Formato no permitido: ${contentType}`);
    if (!data.length) throw new MediaInputError("El archivo está vacío");
    if (data.length > MAX_MEDIA_BYTES) throw new MediaInputError(`El archivo supera ${Math.round(MAX_MEDIA_BYTES / 1024 / 1024)} MB`);

    const decoder = sharp(data, { limitInputPixels: 40_000_000, failOn: "warning" });
    const metadata = await decoder.metadata();
    if (!["jpeg", "png", "webp", "avif", "heif", "gif", "tiff"].includes(metadata.format ?? "")) throw new MediaInputError("El contenido no es una imagen compatible");
    const optimized = await decoder.rotate().resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    data = optimized.data;
    contentType = "image/webp";
    const id = createHash("sha256").update(data).digest("hex").slice(0, 32);
    const thumbnail = await sharp(data).resize({width:360,height:360,fit:"inside",withoutEnlargement:true}).webp({quality:76}).toBuffer();
    const record: StoredMedia = { thumbnail, contentType, size: data.length, data, width: optimized.info.width, height: optimized.info.height, label: "", createdAt: new Date().toISOString() };

    if (this.useMongo) {
      await MediaModel.updateOne({ _id: id }, { $setOnInsert: { ...record, _id: id } }, { upsert: true });
    } else {
      if (!this.memory.has(id)) this.memory.set(id, record);
    }
    return { id, size: data.length, contentType, width: record.width, height: record.height };
  }

  async list(offset = 0, limit = 30, search = "") {
    const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i");
    const filter = search ? { $or: [{label:pattern},{_id:pattern}] } : {};
    if (this.useMongo) {
      const [rows, total] = await Promise.all([MediaModel.find(filter).select("-data -thumbnail").sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit).lean(), MediaModel.countDocuments(filter)]);
      return { rows: rows.map((row) => ({ ...row, id: row._id })), total };
    }
    const rows = [...this.memory].reverse().map(([id, { data, thumbnail, ...row }]) => ({ id, ...row })).filter(row=>pattern.test(`${row.id} ${row.label??""}`));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  }
  async rename(id: string, label: string) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Imagen inválida");
    if (this.useMongo) {
      const result = await MediaModel.updateOne({ _id: id }, { $set: { label } });
      if (!result.matchedCount) throw new Error("Imagen no encontrada");
    } else {
      const row = this.memory.get(id);
      if (!row) throw new Error("Imagen no encontrada");
      row.label = label;
    }
    return { id, label };
  }
  async remove(id: string) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Imagen inválida");
    if (this.useMongo) {
      const pattern = new RegExp(`/media/${id}(?:[?#]|$)`);
      if (await ProductModel.exists({ "variants.images.url": pattern }) || await OrderModel.exists({ "items.image": pattern })) throw new Error("La imagen está vinculada a un producto o pedido");
      return Boolean((await MediaModel.deleteOne({ _id: id })).deletedCount);
    }
    const products = await productService.allForManagement();
    const orders = await orderService.forMediaReferences();
    if (products.some((p) => p.variants.some((v) => v.images.some((i) => new RegExp(`/media/${id}(?:[?#]|$)`).test(i.url)))) || orders.some((o) => o.items.some((i) => new RegExp(`/media/${id}(?:[?#]|$)`).test(i.image ?? "")))) throw new Error("La imagen está vinculada a un producto o pedido");
    return this.memory.delete(id);
  }

  /** 720 px para pantallas de alta densidad (C64). Si la foto es más chica, la misma foto. */
  private async medium(full: Buffer) {
    const meta = await sharp(full).metadata();
    if ((meta.width ?? 0) <= 720 && (meta.height ?? 0) <= 720) return full;
    return sharp(full).resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  }

  async get(id: string, size: MediaSize = "full"): Promise<StoredMedia | null> {
    if (!/^[a-f0-9]{32}$/.test(id)) return null;
    if (this.useMongo) {
      // Solo el binario pedido (antes se leía el documento entero para servir la miniatura).
      // Sin lean(): asi mongoose devuelve el binario ya como Buffer de Node.
      const fields = size === "thumb" ? "contentType size thumbnail data" : size === "medium" ? "contentType size medium" : "contentType size data";
      const found = await MediaModel.findById(id).select(fields);
      if (!found) return null;
      if (size === "medium" && !found.medium) {
        const full = await MediaModel.findById(id).select("data");
        const medium = await this.medium(Buffer.from(full!.data));
        await MediaModel.updateOne({ _id: id }, { $set: { medium } });
        return { contentType: found.contentType, size: found.size, data: medium };
      }
      const data = size === "thumb" ? found.thumbnail ?? found.data : size === "medium" ? found.medium! : found.data;
      return { contentType: found.contentType, size: found.size, data: Buffer.from(data) };
    }
    const record = this.memory.get(id);
    if (!record) return null;
    if (size === "medium" && !record.medium) record.medium = await this.medium(record.data);
    return { ...record, data: size === "thumb" ? record.thumbnail ?? record.data : size === "medium" ? record.medium! : record.data };
  }
}

export const mediaService = new MediaService();
