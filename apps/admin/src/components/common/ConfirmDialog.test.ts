import { describe, expect, it, vi } from "vitest";
import { createConfirmationManager } from "./ConfirmDialog";
describe("Confirmaciones de formulario",()=>{
  it("conserva la decisión activa y resuelve una solicitud concurrente sin sobrescribirla",async()=>{
    const show=vi.fn();const manager=createConfirmationManager(show);
    const first=manager.request({title:"Salir",message:"Hay cambios"});
    expect(await manager.request({title:"Eliminar",message:"Otro cambio"})).toBe(false);
    expect(show).toHaveBeenCalledTimes(1);
    manager.finish(true);expect(await first).toBe(true);
  });
  it("resuelve como cancelada una decisión pendiente al desmontar",async()=>{
    const manager=createConfirmationManager(()=>{});
    const pending=manager.request({title:"Salir",message:"Hay cambios"});
    manager.cancel();expect(await pending).toBe(false);
  });
});
