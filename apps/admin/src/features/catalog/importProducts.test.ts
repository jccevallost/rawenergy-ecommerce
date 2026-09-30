import {describe,it,expect} from "vitest";
import {importColumns,parseCsv,prepareImport} from "./importProducts";
const row=["camiseta","Camiseta","RawEnergy","Camiseta para entrenar","APPAREL","Ropa","Entrenamiento","Negro",1,"M","CAM-M",25,0,5,"","",0,0,0,0];
describe("Importación de catálogo",()=>{
 it("lee campos entre comillas, saltos de línea y comillas escapadas",()=>{expect(parseCsv('a,b\n"uno, dos","línea 1\nlínea 2"')).toEqual([["a","b"],["uno, dos","línea 1\nlínea 2"]]);expect(()=>parseCsv('a,b\n"sin cerrar')).toThrow();});
 it("agrupa variantes conservando las filas del archivo y no acepta datos generales contradictorios",()=>{const second=[...row];second[9]="L";second[10]="CAM-L";const groups=prepareImport([importColumns,row,second]);expect(groups[0]?.payload.variants).toHaveLength(2);expect(groups[0]?.rows).toEqual([2,3]);second[2]="Otra marca";expect(()=>prepareImport([importColumns,row,second])).toThrow(/no coinciden/);});
 it("informa columna ausente y números inválidos antes de enviar el archivo",()=>{expect(()=>prepareImport([["nombre"],["ejemplo"]])).toThrow(/columna/);const invalid=[...row];invalid[11]="veinte";expect(()=>prepareImport([importColumns,invalid])).toThrow(/Fila 2: precio/);});
});
