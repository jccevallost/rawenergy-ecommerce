import { describe, expect, it, vi } from "vitest";
import { panelHash, parsePanelRoute, PanelNavigator, panelFilterValue, type PanelHistory } from "./panelRoute";

function historyFixture() {
  const entries = [{hash: "#products?q=caf%C3%A9", index: 0}];
  let cursor = 0;
  const history: PanelHistory = {
    read: () => entries[cursor]!,
    push: (hash, index) => { entries.splice(cursor + 1); entries.push({hash, index}); cursor++; },
    replace: (hash, index) => { entries[cursor] = {hash, index}; },
    go: delta => { cursor += delta; }
  };
  return history;
}
describe("Rutas del administrador",()=>{
  it("conserva registro, filtros y caracteres especiales al compartir o recargar una ruta",()=>{
    const route={section:"products" as const,params:{record:"product-12",q:"Proteína & café",archived:"true",page:"2"}};
    expect(parsePanelRoute(panelHash(route))).toEqual(route);
  });
  it("admite la importación y lleva rutas desconocidas al inicio",()=>{
    expect(parsePanelRoute("#import").section).toBe("import");
    expect(parsePanelRoute("#no-existe").section).toBe("home");
  });
  it("conserva filtros al volver a un módulo y al cerrar un registro", async () => {
    const history=historyFixture(); const navigator=new PanelNavigator(history, async()=>true);
    await navigator.go("products", {record:"p1"});
    expect(navigator.snapshot().params).toEqual({q:"café",record:"p1"});
    await navigator.go("orders");
    await navigator.go("products");
    expect(navigator.snapshot().params).toEqual({q:"café"});
  });
  it("cancelar Atrás conserva la ficha, sus filtros y la posición de historial", async () => {
    const history=historyFixture(); const leave=vi.fn(async()=>true);
    const navigator=new PanelNavigator(history,leave);
    await navigator.go("products",{record:"p1"});
    leave.mockResolvedValue(false); history.go(-1);
    await navigator.external(); await navigator.external();
    expect(history.read().hash).toBe(panelHash(navigator.snapshot()));
    expect(navigator.snapshot().params.record).toBe("p1");
    expect(navigator.snapshot().params.q).toBe("café");
    leave.mockResolvedValue(true); history.go(-1); await navigator.external();
    expect(navigator.snapshot().params.record).toBeUndefined();
  });
  it("no aplica filtros mientras se decide una salida y evita diálogos duplicados", async () => {
    const history=historyFixture(); let accept!:(value:boolean)=>void;
    const leave=vi.fn(()=>new Promise<boolean>(resolve=>{accept=resolve;}));
    const navigator=new PanelNavigator(history,leave);
    const pending=navigator.go("orders");
    expect(navigator.patch({q:"perdido"})).toBe(false);
    expect(await navigator.go("home")).toBe(false);
    expect(navigator.snapshot().section).toBe("products");
    accept(false); expect(await pending).toBe(false);
    expect(leave).toHaveBeenCalledTimes(1);
    expect(navigator.snapshot().params.q).toBe("café");
  });
  it("rechaza páginas negativas o fraccionarias también en la biblioteca incrustada", () => {
    expect(panelFilterValue(parsePanelRoute("#products?media.page=-2"),"media.page",0)).toBe(0);
    expect(panelFilterValue(parsePanelRoute("#orders?page=1.5"),"page",0)).toBe(0);
    expect(panelFilterValue(parsePanelRoute("#orders?page=2"),"page",0)).toBe(2);
  });
});
