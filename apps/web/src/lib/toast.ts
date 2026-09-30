import { useSyncExternalStore } from "react";

// Avisos breves y no bloqueantes («Agregado al carrito»). Se anuncian por una
// región role="status" y nunca son el único acceso a una acción.
export type Toast = { id: number; message: string; action?: { label: string; run: () => void } };

let toasts: Toast[] = [];
let serial = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export function dismissToast(id: number) {
  toasts = toasts.filter(toast => toast.id !== id);
  emit();
}

export function showToast(message: string, action?: Toast["action"]) {
  const id = ++serial;
  toasts = [...toasts.slice(-1), { id, message, action }];
  emit();
  return id;
}

export const useToasts = () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => toasts);
