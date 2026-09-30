import { useEffect, useSyncExternalStore } from "react";

// Diálogos abiertos que deben volver inerte el resto de la tienda. App lo consulta
// para aplicar `inert`, bloquear el desplazamiento y devolver el foco al cerrar.
let open = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export function useModalLayer(active: boolean) {
  useEffect(() => {
    if (!active) return;
    open += 1; emit();
    return () => { open -= 1; emit(); };
  }, [active]);
}

export const useAnyModalLayer = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => open > 0);
