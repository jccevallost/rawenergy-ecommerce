import { useEffect, useMemo, useRef, useState } from "react";
import { ApolloError, useMutation, useQuery } from "@apollo/client";
import { GET_ADMIN_PRODUCTS, MERGE_PRODUCTS, type Product, type ProductConnection } from "@vital-forge/shared-logic";

const sizeText = (variant: Product["variants"][number]) => `${variant.size?.value ?? variant.sizeValue ?? ""} ${variant.size?.unit ?? variant.sizeUnit ?? ""}`.trim();
const errorText = (error: unknown) => error instanceof ApolloError ? error.graphQLErrors[0]?.message ?? error.message : error instanceof Error ? error.message : "No se pudo unir.";

/**
 * Unir un producto como presentación de otro (C49): el mismo producto cargado en
 * otra ficha por tener otro tamaño (p. ej. la creatina de 1 kg). Sus presentaciones
 * pasan al destino con stock, fotos y SKU; el origen queda archivado.
 */
export function MergeProductDialog({ source, onClose, onDone }: { source: Product; onClose: () => void; onDone: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const list = useQuery<{ searchProducts: ProductConnection }>(GET_ADMIN_PRODUCTS, { variables: { filters: { status: "ACTIVE" }, pagination: { first: 100 } }, fetchPolicy: "network-only" });
  const [merge, state] = useMutation<{ mergeProducts: { movedSkus: string[]; orders: number } }>(MERGE_PRODUCTS);
  const candidates = useMemo(() => (list.data?.searchProducts.edges.map(edge => edge.node) ?? [])
    .filter(product => product.id !== source.id)
    .sort((a, b) => Number(b.brand.toLowerCase().startsWith(source.brand.toLowerCase().split(" ")[0] ?? "")) - Number(a.brand.toLowerCase().startsWith(source.brand.toLowerCase().split(" ")[0] ?? "")) || a.title.localeCompare(b.title, "es")), [list.data, source]);
  const [targetId, setTargetId] = useState("");
  const target = candidates.find(product => product.id === targetId);
  const [flavors, setFlavors] = useState<Record<string, string>>(() => Object.fromEntries(source.variants.map(v => [v.sku, v.flavor])));
  const [error, setError] = useState("");
  // Con un solo sabor en el destino, se propone ese nombre (p. ej. «Unflavored» → «Sin sabor»).
  useEffect(() => {
    const names = [...new Set(target?.variants.map(v => v.flavor) ?? [])];
    if (names.length === 1) setFlavors(Object.fromEntries(source.variants.map(v => [v.sku, names[0]!])));
    else setFlavors(Object.fromEntries(source.variants.map(v => [v.sku, v.flavor])));
  }, [target, source]);
  const resulting = target ? [...new Set([...target.variants, ...source.variants].map(sizeText))].join(" · ") : "";
  const close = () => { dialog.current?.close(); onClose(); };
  const submit = async () => {
    if (!target) { setError("Elige el producto al que se une."); return; }
    setError("");
    try {
      const { data } = await merge({ variables: { input: { sourceId: source.id, targetId: target.id, flavors, sourceRevision: source.revision ?? 0, targetRevision: target.revision ?? 0 } } });
      const moved = data?.mergeProducts;
      dialog.current?.close();
      onDone(`«${source.title}» ahora es ${moved && moved.movedSkus.length > 1 ? "parte" : "una presentación"} de «${target.title}».${moved?.orders ? ` ${moved.orders} ${moved.orders === 1 ? "pedido pasó" : "pedidos pasaron"} al producto unido.` : ""}`);
    } catch (caught) { setError(errorText(caught)); }
  };

  return (
    <dialog ref={dialog} className="confirm-dialog merge-dialog" aria-labelledby="merge-title" onCancel={event => { event.preventDefault(); close(); }}>
      <h2 id="merge-title">Unir «{source.title}» a otro producto</h2>
      <p>Úsalo cuando es el mismo producto en otro tamaño o sabor. Sus presentaciones pasan al producto que elijas con su stock, fotos y SKU; esta ficha queda archivada y sus pedidos pasan al otro producto.</p>
      <label className="merge-field">Producto al que se une
        <select autoFocus value={targetId} onChange={event => setTargetId(event.target.value)} aria-busy={list.loading}>
          <option value="">{list.loading ? "Cargando productos…" : "Elige un producto"}</option>
          {candidates.map(product => <option key={product.id} value={product.id}>{product.brand} · {product.title} ({[...new Set(product.variants.map(sizeText))].join(", ")})</option>)}
        </select>
      </label>
      <fieldset className="merge-variants">
        <legend>Presentaciones que se mueven</legend>
        {source.variants.map(variant => (
          <label key={variant.sku} className="merge-field">{sizeText(variant)} · {variant.stock} u. · <small>{variant.sku}</small>
            <span className="merge-flavor">Sabor en el producto destino
              <input list="merge-flavors" value={flavors[variant.sku] ?? ""} maxLength={60} onChange={event => setFlavors(current => ({ ...current, [variant.sku]: event.target.value }))} />
            </span>
          </label>
        ))}
        <datalist id="merge-flavors">{[...new Set(target?.variants.map(v => v.flavor) ?? [])].map(name => <option key={name} value={name} />)}</datalist>
        <p className="merge-hint">Usa el mismo nombre de sabor que el producto destino para que los tamaños se vean juntos en la tienda.</p>
      </fieldset>
      {target && <p className="merge-summary" role="status">«{target.title}» quedará con: {resulting}.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" onClick={close}>Cancelar</button>
        <button type="button" className="primary-button" disabled={!target || state.loading} onClick={() => void submit()}>{state.loading ? "Uniendo…" : "Unir productos"}</button>
      </div>
    </dialog>
  );
}
