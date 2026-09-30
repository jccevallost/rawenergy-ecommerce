import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useConfirm } from "./ConfirmDialog";

type Entry = { persist?: () => void; busy?: boolean };
type Registry = { entries: Map<symbol, Entry>; leave: () => Promise<boolean> };
const Context = createContext<Registry | null>(null);
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<symbol, Entry>());
  const confirm = useConfirm();
  const value = useMemo<Registry>(() => ({ entries: entries.current, leave: async () => {
    const pending = [...entries.current.values()];
    if (!pending.length) return true;
    if (pending.some(entry => entry.busy)) {
      await confirm({ title: "Operación en curso", message: "Espera a que termine el guardado o la carga antes de salir.", confirmLabel: "Entendido" });
      return false;
    }
    try { pending.forEach(entry => entry.persist?.()); }
    catch {
      await confirm({ title: "No se pudo conservar el borrador", message: "El navegador no pudo guardar los cambios. Guarda el formulario antes de salir.", confirmLabel: "Entendido" });
      return false;
    }
    return confirm({ title: "Cambios sin guardar", message: pending.every(entry => entry.persist)
      ? "El borrador se conservará para tu cuenta en este navegador. Los cambios todavía no están publicados."
      : "Hay datos sin guardar en el formulario. Salir descartará esos cambios. Puedes cancelar y guardarlos primero.", confirmLabel: "Salir del formulario", danger: true });
  } }), [confirm]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!entries.current.size) return;
      try { entries.current.forEach(entry => entry.persist?.()); } catch { /* Keep the native leave warning even when storage is full. */ }
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useUnsavedChanges(dirty: boolean, entry: Entry = {}) {
  const registry = useContext(Context);
  const id = useRef(Symbol("form"));
  useLayoutEffect(() => {
    if (dirty || entry.busy) registry?.entries.set(id.current, entry);
    else registry?.entries.delete(id.current);
    return () => { registry?.entries.delete(id.current); };
  }, [registry, dirty, entry.persist, entry.busy]);
}
export function useLeaveGuard() {
  const registry = useContext(Context);
  return registry?.leave ?? (async () => true);
}
