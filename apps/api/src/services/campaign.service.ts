import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { IMAGE_URL } from "../validation/product.js";
import { operationContext, registerMemoryStore, unitOfWork } from "../lib/unitOfWork.js";
import { suggestedCampaigns } from "../data/suggestedCampaigns.js";
import { productService } from "./product.service.js";

// Campañas de portada: texto editorial, fechas y una selección de productos del
// catálogo (por objetivo, marca o elección manual). No guardan precios ni
// descuentos: la tienda muestra los precios vigentes de cada producto.
export const campaignThemes = ["NOCHE", "ORO", "CLARO"] as const;

/** Fecha de hoy en Ecuador (UTC-5, sin horario de verano). */
export const ecuadorToday = (now = Date.now()) => new Date(now - 5 * 3600000).toISOString().slice(0, 10);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Usa una fecha válida");
const slug = z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/);
export const campaignInputSchema = z.object({
  slug: z.string().trim().min(3).max(60).regex(/^[a-z0-9-]+$/, "Usa minúsculas, números y guiones"),
  title: z.string().trim().min(5).max(70),
  eyebrow: z.string().trim().min(3).max(40),
  message: z.string().trim().min(10).max(180),
  ctaLabel: z.string().trim().min(3).max(30),
  theme: z.enum(campaignThemes),
  startsOn: isoDate,
  endsOn: isoDate,
  active: z.boolean(),
  priority: z.number().int().min(0).max(100),
  goals: z.array(slug).max(6).default([]),
  brands: z.array(z.string().trim().min(1).max(80)).max(6).default([]),
  productIds: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  imageUrl: z.string().trim().max(600).refine(value => value === "" || IMAGE_URL.test(value), "Usa una imagen de la biblioteca o una dirección https").default("")
}).strict()
  .refine(value => value.endsOn >= value.startsOn, { message: "La fecha final debe ser igual o posterior a la inicial", path: ["endsOn"] })
  .refine(value => value.goals.length + value.brands.length + value.productIds.length > 0, { message: "Elige al menos un objetivo, una marca o un producto", path: ["goals"] });

type Actor = { id: string; name: string };
export type CampaignInput = z.infer<typeof campaignInputSchema>;
export type Campaign = CampaignInput & { id: string; revision: number; suggested: boolean; createdByName: string; updatedByName: string; createdAt: string; updatedAt: string };
export type CampaignStatus = "LIVE" | "SCHEDULED" | "ENDED" | "PAUSED";

const schema = new mongoose.Schema({
  _id: String, slug: { type: String, required: true, unique: true }, title: String, eyebrow: String, message: String, ctaLabel: String,
  theme: { type: String, enum: campaignThemes }, startsOn: String, endsOn: String, active: Boolean, priority: Number,
  goals: [String], brands: [String], productIds: [String], imageUrl: String,
  revision: { type: Number, default: 0 }, suggested: { type: Boolean, default: false }, createdByName: String, updatedByName: String
}, { timestamps: true });
schema.index({ active: 1, startsOn: 1, endsOn: 1 });
export const CampaignModel = (mongoose.models.Campaign ?? mongoose.model("Campaign", schema)) as mongoose.Model<mongoose.InferSchemaType<typeof schema>>;

let memory: Campaign[] = [];
registerMemoryStore(() => memory, value => { memory = value; });
const mongo = () => mongoose.connection.readyState === 1;
const normalize = (value: any): Campaign => ({
  id: String(value._id ?? value.id), slug: value.slug, title: value.title, eyebrow: value.eyebrow, message: value.message, ctaLabel: value.ctaLabel,
  theme: value.theme, startsOn: value.startsOn, endsOn: value.endsOn, active: Boolean(value.active), priority: value.priority ?? 0,
  goals: [...(value.goals ?? [])], brands: [...(value.brands ?? [])], productIds: [...(value.productIds ?? [])], imageUrl: value.imageUrl ?? "",
  revision: value.revision ?? 0, suggested: Boolean(value.suggested), createdByName: value.createdByName ?? "", updatedByName: value.updatedByName ?? "",
  createdAt: new Date(value.createdAt ?? Date.now()).toISOString(), updatedAt: new Date(value.updatedAt ?? Date.now()).toISOString()
});
const byPriority = (a: Campaign, b: Campaign) => b.priority - a.priority || a.startsOn.localeCompare(b.startsOn) || a.slug.localeCompare(b.slug);

export const campaignStatus = (campaign: Pick<Campaign, "active" | "startsOn" | "endsOn">, today = ecuadorToday()): CampaignStatus =>
  !campaign.active ? "PAUSED" : today < campaign.startsOn ? "SCHEDULED" : today > campaign.endsOn ? "ENDED" : "LIVE";

export const campaignService = {
  async all(): Promise<Campaign[]> {
    const rows = mongo() ? (await CampaignModel.find().lean()).map(normalize) : memory;
    return [...rows].sort(byPriority);
  },
  async get(id: string): Promise<Campaign | null> {
    const row = mongo() ? await CampaignModel.findById(id).lean() : memory.find(campaign => campaign.id === id);
    return row ? normalize(row) : null;
  },
  /** Campañas visibles hoy para el cliente, de mayor a menor prioridad. */
  async live(today = ecuadorToday()): Promise<Campaign[]> {
    return (await this.all()).filter(campaign => campaignStatus(campaign, today) === "LIVE");
  },
  async liveBySlug(value: string, today = ecuadorToday()): Promise<Campaign | null> {
    return (await this.live(today)).find(campaign => campaign.slug === value) ?? null;
  },
  /** Productos vendibles: primero los elegidos a mano, luego los que coinciden con objetivo o marca y tienen existencias. */
  async products(campaign: Campaign, limit = 8) {
    const safeLimit = Math.min(Math.max(limit, 1), 24);
    const picked = (await Promise.all(campaign.productIds.map(id => productService.getSellable(id)))).filter(Boolean);
    const matched = campaign.goals.length || campaign.brands.length
      ? (await productService.search({ goals: campaign.goals.length ? campaign.goals : undefined, brands: campaign.brands.length ? campaign.brands : undefined, inStock: true }, { first: safeLimit })).edges.map(edge => edge.node)
      : [];
    const seen = new Set<string>();
    return [...picked, ...matched].filter(product => {
      const id = String((product as { id?: unknown; _id?: unknown }).id ?? (product as { _id?: unknown })._id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }).slice(0, safeLimit);
  },
  async save(id: string, raw: unknown, revision: number | undefined, actor: Actor): Promise<Campaign> {
    if (!operationContext.getStore()) return unitOfWork(() => this.save(id, raw, revision, actor));
    z.string().uuid().parse(id);
    const input = campaignInputSchema.parse(raw);
    const current = await this.get(id);
    if (revision === undefined && current) throw new Error("Esta campaña ya existe. Actualiza la lista antes de editarla.");
    if (revision !== undefined && (!current || current.revision !== revision)) throw new Error("Otra persona modificó esta campaña. Actualiza la lista; tus cambios siguen en el formulario.");
    const duplicate = (await this.all()).find(campaign => campaign.slug === input.slug && campaign.id !== id);
    if (duplicate) throw new Error("Ya existe una campaña con ese identificador. Cambia el identificador de la dirección.");
    const now = new Date().toISOString();
    const result: Campaign = { ...input, id, revision: current ? current.revision + 1 : 0, suggested: current?.suggested ?? false, createdByName: current?.createdByName ?? actor.name, updatedByName: actor.name, createdAt: current?.createdAt ?? now, updatedAt: now };
    if (mongo()) {
      if (!current) await CampaignModel.create({ ...result, _id: id });
      else {
        const changed = await CampaignModel.updateOne({ _id: id, revision }, { $set: { ...result, revision: result.revision } });
        if (!changed.matchedCount) throw new Error("Otra persona modificó esta campaña. Actualiza la lista.");
      }
    } else if (current) memory = memory.map(campaign => campaign.id === id ? result : campaign);
    else memory.push(result);
    return result;
  },
  async remove(id: string, revision: number): Promise<boolean> {
    if (!operationContext.getStore()) return unitOfWork(() => this.remove(id, revision));
    const current = await this.get(id);
    if (!current || current.revision !== revision) throw new Error("La campaña cambió o ya no existe. Actualiza la lista.");
    if (mongo()) {
      const deleted = await CampaignModel.deleteOne({ _id: id, revision });
      if (!deleted.deletedCount) throw new Error("La campaña cambió. Actualiza la lista.");
    } else memory = memory.filter(campaign => campaign.id !== id);
    return true;
  },
  /**
   * Carga las campañas sugeridas solo si no existe ninguna: nunca reemplaza ni
   * duplica lo que el negocio ya creó, editó o eliminó después.
   */
  /** Al unir un producto con otro (C49), las campañas que lo mostraban pasan a mostrar el destino. */
  async replaceProduct(sourceId: string, targetId: string) {
    const swap = (ids: string[]) => [...new Set(ids.map(id => id === sourceId ? targetId : id))];
    if (mongo()) {
      for (const row of await CampaignModel.find({ productIds: sourceId }).lean()) await CampaignModel.updateOne({ _id: row._id }, { $set: { productIds: swap((row.productIds ?? []) as string[]) }, $inc: { revision: 1 } });
      return;
    }
    memory = memory.map(campaign => campaign.productIds.includes(sourceId) ? { ...campaign, productIds: swap(campaign.productIds), revision: (campaign.revision ?? 0) + 1 } : campaign);
  },
  async bootstrap() {
    const count = mongo() ? await CampaignModel.estimatedDocumentCount() : memory.length;
    if (count > 0) return 0;
    const now = new Date().toISOString();
    const rows: Campaign[] = suggestedCampaigns.map(raw => ({ ...campaignInputSchema.parse(raw), id: randomUUID(), revision: 0, suggested: true, createdByName: "Campaña sugerida", updatedByName: "Campaña sugerida", createdAt: now, updatedAt: now }));
    if (mongo()) await CampaignModel.insertMany(rows.map(row => ({ ...row, _id: row.id })), { ordered: false }).catch(error => { if (error?.code !== 11000) throw error; });
    else memory = rows;
    return rows.length;
  }
};
