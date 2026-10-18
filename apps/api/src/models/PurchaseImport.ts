import mongoose from "mongoose";
const { Schema } = mongoose;

// IMP-01 (M10): PDF original privado. El id es el sha256 del archivo: el mismo PDF no se guarda dos veces.
// Nunca se publica ni se sirve en caché pública; solo personal con permiso de compras lo descarga.
const importFile = new Schema({ _id: String, contentType: String, size: Number, data: { type: Buffer, required: true }, uploadedBy: String }, { timestamps: true, _id: false });

// Importación de una factura: estado propio, distinto de la compra (subida → revisión → registrada).
const purchaseImport = new Schema({
  _id: String, fileHash: { type: String, required: true }, status: { type: String, enum: ["REQUIERE_REVISION", "LISTO", "REGISTRADO", "FALLIDO", "DESCARTADO"], required: true },
  failure: String, template: String, parserVersion: Number,
  supplier: Schema.Types.Mixed, document: Schema.Types.Mixed, totals: Schema.Types.Mixed, additional: Schema.Types.Mixed,
  lines: Schema.Types.Mixed, exceptions: Schema.Types.Mixed, reconciliation: Schema.Types.Mixed,
  documentKey: { type: String, index: true }, purchaseId: String, purchaseNumber: String,
  createdBy: String, createdByName: String, discardReason: String, revision: { type: Number, default: 0 }
}, { timestamps: true });
// Un mismo PDF produce una sola importación, también con dos subidas simultáneas.
purchaseImport.index({ fileHash: 1 }, { unique: true });
purchaseImport.index({ createdAt: -1 });

// Equivalencia aprobada entre el código del proveedor y una presentación del catálogo (M12).
const supplierAlias = new Schema({ _id: String, supplierTaxId: String, code: String, productId: String, sku: String, description: String, approvedBy: String }, { timestamps: true });

export const ImportFileModel = (mongoose.models.PurchaseImportFile ?? mongoose.model("PurchaseImportFile", importFile)) as mongoose.Model<mongoose.InferSchemaType<typeof importFile>>;
export const PurchaseImportModel = (mongoose.models.PurchaseImport ?? mongoose.model("PurchaseImport", purchaseImport)) as mongoose.Model<mongoose.InferSchemaType<typeof purchaseImport>>;
export const SupplierAliasModel = (mongoose.models.SupplierAlias ?? mongoose.model("SupplierAlias", supplierAlias)) as mongoose.Model<mongoose.InferSchemaType<typeof supplierAlias>>;
