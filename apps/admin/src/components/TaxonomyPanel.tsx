import { useUnsavedChanges, useLeaveGuard } from "./common/UnsavedChanges";
import { ArrowRightLeft, Check, Pencil, Tags, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { TaxonomyAction, TaxonomyEntry, TaxonomyKind, TaxonomyOverview } from "@vital-forge/shared-logic";

type Group = { kind: TaxonomyKind; title: string; helper: string; entries: TaxonomyEntry[] };
type Draft = { kind: TaxonomyKind; key: string; action: TaxonomyAction; value: string } | null;

export function TaxonomyPanel({ taxonomy, loading, error, onApply }: {
  taxonomy?: TaxonomyOverview;
  loading: boolean;
  error: boolean;
  onApply: (kind: TaxonomyKind, action: TaxonomyAction, key: string, target?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(null);
  const [working, setWorking] = useState(false);
  const [saveError, setSaveError] = useState("");
  const leave = useLeaveGuard();
  useUnsavedChanges(Boolean(draft), {busy: working});
  const openDraft = async (next: NonNullable<Draft>) => {
    if (working || !await leave()) return;
    setSaveError("");
    setDraft(next);
  };

  const groups: Group[] = [
    { kind: "CATEGORY", title: "Categorias", helper: "Como se agrupa el catalogo en la tienda.", entries: taxonomy?.categories ?? [] },
    { kind: "GOAL", title: "Objetivos", helper: "Los que el cliente elige en la portada.", entries: taxonomy?.goals ?? [] },
    { kind: "BRAND", title: "Marcas", helper: "Se escriben en cada producto: aqui se unifican.", entries: taxonomy?.brands ?? [] }
  ];

  const apply = async () => {
    if (!draft) return;
    setWorking(true); setSaveError("");
    try {
      await onApply(draft.kind, draft.action, draft.key, draft.action === "REMOVE" ? undefined : draft.value);
      setDraft(null);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "No se pudo guardar. Conservamos los datos del formulario."); } finally {
      setWorking(false);
    }
  };

  return (
    <section className="admin-section">
      <header>
        <div>
          <span className="kicker"><Tags /> Organizacion del catalogo</span>
          <h1>Categorías y marcas</h1>
          <p>
            {error ? "No se pudo leer la organizacion del catalogo."
              : loading ? "Calculando etiquetas..."
              : "Renombrar cambia el nombre visible en todos los productos. Fusionar mueve los productos de una etiqueta a otra."}
          </p>
        </div>
      </header>

      {saveError && <p role="alert">{saveError}</p>}
      <div className="taxonomy-grid">
        {groups.map((group) => (
          <article key={group.kind}>
            <header><b>{group.title}</b><small>{group.helper}</small></header>
            {!group.entries.length && <p className="taxonomy-empty">{loading ? "Cargando..." : "Todavía no hay ninguna."}</p>}
            <ul>
              {group.entries.map((entry) => {
                const editing = draft?.kind === group.kind && draft.key === entry.key;
                return (
                  <li key={entry.key}>
                    <div className="taxonomy-row">
                      <div className="taxonomy-name">
                        <b>{entry.name}</b>
                        {group.kind !== "BRAND" && <small>{entry.key}</small>}
                      </div>
                      <span className="taxonomy-count">{entry.productCount}</span>
                      <div className="taxonomy-actions">
                        <button disabled={working} title="Renombrar" aria-label={`Renombrar ${entry.name}`} onClick={() => void openDraft({ kind: group.kind, key: entry.key, action: "RENAME", value: entry.name })}><Pencil size={13} /></button>
                        <button disabled={working} title="Fusionar con otra" aria-label={`Fusionar ${entry.name}`} onClick={() => void openDraft({ kind: group.kind, key: entry.key, action: "MERGE", value: "" })}><ArrowRightLeft size={13} /></button>
                        {group.kind !== "BRAND" && (
                          <button disabled={working} className="danger" title="Quitar de todos los productos" aria-label={`Quitar ${entry.name}`} onClick={() => void openDraft({ kind: group.kind, key: entry.key, action: "REMOVE", value: "" })}><Trash2 size={13} /></button>
                        )}
                      </div>
                    </div>

                    {editing && (
                      <div className="taxonomy-draft">
                        {draft.action === "RENAME" && (
                          <label>
                            <span>Nombre nuevo</span>
                            <input disabled={working} autoFocus value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} />
                          </label>
                        )}
                        {draft.action === "MERGE" && (
                          <label>
                            <span>Mover sus {entry.productCount} productos a</span>
                            <select disabled={working} autoFocus value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })}>
                              <option value="">Elige una etiqueta</option>
                              {group.entries.filter((other) => other.key !== entry.key).map((other) => (
                                <option key={other.key} value={other.key}>{other.name}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        {draft.action === "REMOVE" && (
                          <p className="taxonomy-warn">Se quitara "{entry.name}" de {entry.productCount} producto{entry.productCount === 1 ? "" : "s"}. Los productos no se borran.</p>
                        )}
                        <div className="taxonomy-confirm">
                          <button className="publish" disabled={working || (draft.action !== "REMOVE" && !draft.value.trim())} onClick={() => void apply()}>
                            <Check size={13} />{working ? "Aplicando..." : "Aplicar"}
                          </button>
                          <button disabled={working} onClick={async () => { if (await leave()) { setDraft(null); setSaveError(""); } }}><X size={13} />Cancelar</button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
