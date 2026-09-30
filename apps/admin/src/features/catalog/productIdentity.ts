import { generateVariantMatrix, type VariantDraft } from "@vital-forge/shared-logic";
export const productSlug = (value:string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0,160);
export function updateProductIdentity(current:{title:string;slug:string;variants:VariantDraft[]},title:string,published:boolean) {
 const slug=!published && (!current.slug || current.slug===productSlug(current.title)) ? productSlug(title) : current.slug;
 const flavors=[...new Set(current.variants.map(v=>v.flavor))];
 const sizes=current.variants.map(v=>v.size).filter((size,index,all)=>all.findIndex(other=>other.value===size.value&&other.unit===size.unit)===index);
 const matches=(v:VariantDraft,other:VariantDraft)=>v.flavor===other.flavor&&v.size.value===other.size.value&&v.size.unit===other.size.unit;
 const previous=generateVariantMatrix(current.slug,flavors,sizes);
 const manual=current.variants.filter(v=>v.sku!==previous.find(other=>matches(v,other))?.sku);
 const next=published?[]:generateVariantMatrix(slug,flavors,sizes,manual);
 const variants=published?current.variants:current.variants.map(v=>manual.includes(v)?v:{...v,sku:next.find(other=>matches(v,other))!.sku});
 return {title,slug,variants};
}
