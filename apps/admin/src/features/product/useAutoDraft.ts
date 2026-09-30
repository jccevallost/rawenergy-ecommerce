import { useEffect, useState } from "react";

export function useAutoDraft<T>(key: string, value: T, enabled = true) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    if (!enabled) { setStatus("idle"); return; }
    setStatus("saving");
    const timer = window.setTimeout(() => {
      setStatus(writeDraft(key, value) ? "saved" : "error");
    }, 650);
    return () => window.clearTimeout(timer);
  }, [key, value, enabled]);
  return status;
}

export const productDraftKey = (ownerId: string, productId?: string) => `rawenergy-product-draft:${encodeURIComponent(ownerId)}${productId ? `:${encodeURIComponent(productId)}` : ""}`;

export function readDraft<T>(key: string, fallback: T, validate?: (value: unknown) => boolean): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "");
    return validate && !validate(value) ? fallback : value as T;
  } catch { return fallback; }
}

export function writeDraft(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function removeDraft(key: string): boolean {
  try { localStorage.removeItem(key); return true; } catch { return false; }
}
