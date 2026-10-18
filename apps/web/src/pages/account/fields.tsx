import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import type { SaveState } from "./useProfileSave";

// CU06: campos con etiqueta visible, ayuda y error asociados por aria-describedby; mismo estilo que el checkout.
type Common = { id: string; label: string; error?: string; help?: string };

const describedBy = (id: string, error?: string, help?: string) => [help ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;

export function TextField({ id, label, error, help, ...input }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, help)} {...input} />
      {help && <small id={`${id}-help`} className="field-help">{help}</small>}
      {error && <small id={`${id}-error`} className="field-error">{error}</small>}
    </label>
  );
}

export function SelectField({ id, label, error, help, children, ...select }: Common & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, help)} {...select}>{children}</select>
      {help && <small id={`${id}-help`} className="field-help">{help}</small>}
      {error && <small id={`${id}-error`} className="field-error">{error}</small>}
    </label>
  );
}

/** Resultado junto al bloque: éxito como estado, errores como alerta. */
export function SaveStatus({ state }: { state: SaveState }) {
  if (state.status === "idle" || state.status === "saving" || !state.message) return null;
  const ok = state.status === "saved";
  return <p className={`notice ${ok ? "notice-success" : state.status === "conflict" ? "" : "notice-error"}`} role={ok ? "status" : "alert"}>{state.message}</p>;
}

/** Lleva el foco al primer campo con error, en el orden del formulario. */
export function focusFirstError(prefix: string, order: string[], fields: Record<string, string>) {
  const first = order.find(key => fields[key]);
  if (first) document.getElementById(`${prefix}-${first}`)?.focus();
}
