import { Plus, X } from "lucide-react";
import { useId, useState } from "react";

// Etiqueta asociada al campo y botones con nombre (auditoría C41): un lector de
// pantalla dice «Quitar Chocolate» o «Agregar Sabores», no solo «botón».
// `suggestions` (C66, V20): valores ya usados en el catálogo para no escribir variantes del mismo.
export function TagEditor({ label, values, onChange, placeholder, suggestions }: { label: string; values: string[]; onChange: (values: string[]) => void; placeholder: string; suggestions?: string[] }) {
  const [entry, setEntry] = useState("");
  const id = useId();
  const add = () => { const value = entry.trim(); if (value && !values.includes(value)) onChange([...values, value]); setEntry(""); };
  return <div className="tag-editor"><label htmlFor={id}>{label}</label><div className="tags">{values.map((value) => <span key={value}>{value}<button type="button" aria-label={`Quitar ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}><X size={12} aria-hidden="true"/></button></span>)}<div className="tag-input"><input id={id} list={suggestions?.length ? `${id}-sugerencias` : undefined} value={entry} onChange={(e) => setEntry(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={placeholder}/><button type="button" aria-label={`Agregar a ${label}`} onClick={add}><Plus size={15} aria-hidden="true"/></button></div></div>{!!suggestions?.length && <datalist id={`${id}-sugerencias`}>{suggestions.filter((item) => !values.includes(item)).map((item) => <option key={item} value={item} />)}</datalist>}</div>;
}
