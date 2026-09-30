import { describe, expect, it } from "vitest";
import type { Product } from "@vital-forge/shared-logic";
import { isProductForm, productFormToPayload, productToForm, recoverProductDraft, validateProductForm } from "./productForm";
import { productDraftKey, readDraft } from "../product/useAutoDraft";

const product: Product = {
  id: "p1", revision: 4, title: "Camiseta deportiva", slug: "camiseta", brand: "RawEnergy",
  shortDescription: "Camiseta para entrenamiento diario", productType: "APPAREL", active: true,
  variants: [{sku: "CAM-NEGRO-M", flavor: "Negro", sizeValue: 1, sizeUnit: "M", stock: 3, price: 20,
    imageUrls: ["https://example.test/frente.webp", "https://example.test/espalda.webp"], imageAlts: ["Vista frontal negra", "Costuras de la espalda"]}],
  categories: [{name: "Ropa", slug: "ropa"}], goals: [{name: "Entrenamiento", slug: "entrenamiento"}],
  vitalCoinsReward: 0, maxInstallments: 1, hasFreeShipping: false, priceRange: {min: 20, max: 20}
};

describe("Ficha y borradores de productos", () => {
  it("deja sin declarar lo que la etiqueta no informa, sin convertirlo en cero", () => {
    const form = productToForm({ ...product, productType: "SUPPLEMENT", nutritionalFacts: { servingSize: "1 medida (5 g)", calories: null, protein: null, carbohydrates: null, fats: null } });
    expect(form.calories).toBeNull();
    expect(validateProductForm(form)).toEqual([]);
    expect(productFormToPayload(form, product).nutritionalFacts).toEqual({ servingSize: "1 medida (5 g)", calories: null, protein: null, carbohydrates: null, fats: null });
    expect(isProductForm(JSON.parse(JSON.stringify(form)))).toBe(true);
    expect(validateProductForm({ ...form, protein: -1 })).toContain("Información nutricional: usa números positivos o cero, o deja vacío lo que la etiqueta no declara");
  });
  it("conserva las descripciones al recargar la consulta y guardar otro campo", () => {
    const form = productToForm(product);
    form.title = "Camiseta deportiva nueva";
    expect(validateProductForm(form)).toEqual([]);
    const payload = productFormToPayload(form, product);
    expect(payload.variants[0]?.images.map(image => image.alt)).toEqual(product.variants[0]?.imageAlts);
    expect(payload.variants[0]?.size).toEqual({value: 1, unit: "M"});
    expect(form.sourceRevision).toBe(4);
    expect(form.sourceStocks).toEqual([{sku: "CAM-NEGRO-M", stock: 3}]);
  });
  it("rechaza datos corruptos y separa borradores de cuentas y productos", () => {
    const form = productToForm(product);
    expect(isProductForm(JSON.parse(JSON.stringify(form)))).toBe(true);
    expect(isProductForm({...form, variants: [{...form.variants[0], images: null}]})).toBe(false);
    expect(isProductForm({...form, variants: null})).toBe(false);
    expect(isProductForm({...form, coins: Infinity})).toBe(false);
    expect(productDraftKey("u1", "p1")).not.toBe(productDraftKey("u2", "p1"));
    expect(productDraftKey("u1:p1")).not.toBe(productDraftKey("u1", "p1"));
    expect(readDraft("absent", form, isProductForm)).toBe(form);
  });
  it("detecta precios, cantidades y SKU inválidos antes de enviar", () => {
    const form = productToForm(product);
    form.variants[0]!.stock = 1.5;
    form.variants[0]!.price = 0;
    form.variants.push({...form.variants[0]!});
    const errors = validateProductForm(form).join(" ");
    expect(errors).toContain("stock debe ser un entero");
    expect(errors).toContain("precio debe estar");
    expect(errors).toContain("está repetido");
  });
  it("un borrador mantiene el saldo original para detectar ventas posteriores", () => {
    const draft = productToForm(product);
    draft.variants[0]!.stock = 5;
    const current = productToForm({...product, variants: product.variants.map(v => ({...v, stock: 1}))});
    const recovered = recoverProductDraft(current, draft);
    expect(recovered.sourceStocks?.[0]?.stock).toBe(3);
    expect(recovered.variants[0]?.stock).toBe(5);
    const legacy = {...draft, sourceStocks: undefined};
    expect(recoverProductDraft(current, legacy).variants[0]?.stock).toBe(1);
  });
});
