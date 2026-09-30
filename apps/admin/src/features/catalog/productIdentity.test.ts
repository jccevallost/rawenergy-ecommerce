import { describe,expect,it } from "vitest";
import {generateVariantMatrix} from "@vital-forge/shared-logic";
import {updateProductIdentity} from "./productIdentity";
const initial=()=>({title:"",slug:"",variants:generateVariantMatrix("",["Natural"],[{value:300,unit:"g"}])});
describe("Identificadores de productos",()=>{
 it("acompaña todo el nombre al escribir, sin quedarse en la primera letra",()=>{let form=initial();for(const title of ["C","Cr","Creatina pura"])form=updateProductIdentity(form,title,false);expect(form.slug).toBe("creatina-pura");expect(form.variants[0]?.sku).toBe("CREATINA-PURA-NATURAL-300G");});
 it("conserva identificadores y SKU personalizados",()=>{const form={...initial(),slug:"mi-enlace",variants:initial().variants.map(v=>({...v,sku:"CODIGO-001"}))};expect(updateProductIdentity(form,"Creatina pura",false)).toMatchObject({slug:"mi-enlace",variants:[{sku:"CODIGO-001"}]});});
 it("cambiar el nombre publicado no rompe sus enlaces ni SKU de pedidos",()=>{const form=updateProductIdentity(initial(),"Creatina pura",false);const result=updateProductIdentity(form,"Creatina mejorada",true);expect(result.slug).toBe(form.slug);expect(result.variants).toEqual(form.variants);});
});
