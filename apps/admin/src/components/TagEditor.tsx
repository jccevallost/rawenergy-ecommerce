import { Plus, X } from "lucide-react";
import { useId, useState } from "react";

// Etiqueta asociada al campo y botones con nombre (auditoría C41): un lector de
// pantalla dice «Quitar Chocolate» o «Agregar Sabores», no solo «botón».
export function TagEditor({ label, values, onChange, placeholder }: { label: string; values: string[]; onChange: (values: string[]) => void; placeholder: string }) {
  const [entry, setEntry] = useState("");
  const id = useId();
  const add = () => { const value = entry.trim(); if (value && !values.includes(value)) onChange([...values, value]); setEntry(""); };
  return <div className="tag-editor"><label htmlFor={id}>{label}</label><div className="tags">{values.map((value) => <span key={value}>{value}<button type="button" aria-label={`Quitar ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}><X size={12} aria-hidden="true"/></button></span>)}<div className="tag-input"><input id={id} value={entry} onChange={(e) => setEntry(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={placeholder}/><button type="button" aria-label={`Agregar a ${label}`} onClick={add}><Plus size={15} aria-hidden="true"/></button></div></div></div>;
}
