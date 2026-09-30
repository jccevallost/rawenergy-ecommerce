import { useUnsavedChanges } from "./common/UnsavedChanges";
import { gql, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { useEffect, useRef, useState } from "react";
import { checkoutAttempt, CREATE_CHECKOUT_ORDER, GET_ADMIN_PRODUCTS, type ProductConnection, type OrderCustomer } from "@vital-forge/shared-logic";
const EDIT = gql`mutation EditOrderDetails($id: ID!, $input: JSON!) { editOrderDetails(id: $id, input: $input) { id orderNumber } }`;
const blankCustomer: OrderCustomer = { fullName: "", email: "", phone: "", province: "", city: "", address: "", reference: "", idType: "CEDULA", idNumber: "" };
export function OrderEditor({ row }: { row: (Record<string, unknown> & { id: string }) | null }) {
  const client=useApolloClient();
  const [customer, setCustomer] = useState<OrderCustomer>(blankCustomer); const [notes, setNotes] = useState(""); const [paymentReference, setPaymentReference] = useState(""); const [shipping, setShipping] = useState("EXPRESS_QUITO_VALLES"); const [search, setSearch] = useState(""); const [debounced, setDebounced] = useState(""); const [items, setItems] = useState<Array<{ productId: string; variantSku: string; quantity: number }>>([]); const [message, setMessage] = useState("");
  const [baseline, setBaseline] = useState("");
  const submittingRef = useRef(false); const [submitting, setSubmitting] = useState(false);
  useUnsavedChanges(Boolean(baseline && JSON.stringify({customer, notes, paymentReference, items, shipping}) !== baseline));
  useEffect(() => { setBaseline(JSON.stringify({customer: row?.customer ?? blankCustomer, notes: String(row?.notes ?? ""), paymentReference: String(row?.paymentReference ?? ""), items: [], shipping: "EXPRESS_QUITO_VALLES"})); setShipping("EXPRESS_QUITO_VALLES"); setCustomer(row?.customer as OrderCustomer ?? blankCustomer); setNotes(String(row?.notes ?? "")); setPaymentReference(String(row?.paymentReference ?? "")); setItems([]); setMessage(""); }, [row?.id]);
  useEffect(() => { const timer = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(timer); }, [search]);
  const products = useQuery<{ searchProducts: ProductConnection }>(GET_ADMIN_PRODUCTS, { variables: { filters: { search: debounced, status: "ACTIVE" }, pagination: { first: 20 } }, skip: Boolean(row) });
  const [create, creating] = useMutation(CREATE_CHECKOUT_ORDER); const [edit, editing] = useMutation(EDIT);
  useUnsavedChanges(false, {busy: submitting || creating.loading || editing.loading});
  return <form onSubmit={async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true); setMessage("");
    try {
      let success: string;
      if (row) {
        await edit({ variables: { id: row.id, input: { customer, notes, paymentReference } } });
        setBaseline(JSON.stringify({customer, notes, paymentReference, items, shipping}));
        success = "Datos del pedido guardados.";
      } else {
        const input = { customer, notes, paymentReference, items, shippingMethod: shipping, paymentMethod: "BANK_TRANSFER" };
        const attempt = await checkoutAttempt(input);
        const result = await create({ variables: { input: {...input, idempotencyKey: attempt.key} } });
        const order = result.data?.createCheckoutOrder;
        if (!order) throw new Error("No llegó la confirmación. Vuelve a intentar; se conserva la misma solicitud.");
        attempt.complete();
        success = `Pedido ${order.orderNumber} creado. El stock ya fue reservado.`;
        setItems([]); setBaseline(JSON.stringify({customer, notes, paymentReference, items: [], shipping}));
      }
      setMessage(success);
      await client.refetchQueries({include:["Orders","StaffHome","Records"]}).catch(() => setMessage(`${success} Actualiza la lista para ver los últimos datos.`));
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar"); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }}><fieldset disabled={submitting} style={{border: 0, padding: 0, margin: 0, minWidth: 0}}><h2 data-view-title>{row ? `Datos de ${row.orderNumber}` : "Nuevo pedido"}</h2><div className="fields two">{([["fullName", "Nombre completo", 3, 100], ["email", "Correo", 1, 120], ["phone", "Teléfono", 7, 30], ["province", "Provincia", 2, 80], ["city", "Ciudad", 2, 80], ["address", "Dirección", 8, 240], ["reference", "Referencia de entrega", 0, 180], ["idNumber", "Identificación (factura)", 5, 20]] as const).map(([key, label, min, max]) => <label key={key}>{label}<input required={key !== "reference"} type={key === "email" ? "email" : "text"} minLength={min} maxLength={max} value={customer[key] ?? ""} onChange={(e) => setCustomer({ ...customer, [key]: e.target.value })} /></label>)}<label>Tipo de identificación<select value={customer.idType || "CEDULA"} onChange={(e) => setCustomer({ ...customer, idType: e.target.value as OrderCustomer["idType"] })}><option value="CEDULA">Cédula</option><option value="RUC">RUC</option><option value="PASAPORTE">Pasaporte (extranjeros)</option></select></label><label>Referencia de pago<input maxLength={120} value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} /></label><label className="full">Notas<textarea maxLength={320} value={notes} onChange={(e) => setNotes(e.target.value)} /></label></div>
    {!row && <><label>Envío<select value={shipping} onChange={(e) => setShipping(e.target.value)}><option value="EXPRESS_QUITO_VALLES">Express Quito y Valles</option><option value="SERVIENTREGA_NATIONAL">Servientrega nacional</option></select></label><label>Buscar producto o SKU<input value={search} onChange={(e) => setSearch(e.target.value)} /></label>{products.error && <p role="alert">{products.error.message}</p>}<label>Agregar variante<select value="" onChange={(e) => { if (!e.target.value) return; const [productId, variantSku] = JSON.parse(e.target.value) as [string, string]; setItems((current) => current.some((i) => i.productId === productId && i.variantSku === variantSku) ? current : [...current, { productId, variantSku, quantity: 1 }]); }}><option value="">Selecciona una variante disponible</option>{products.data?.searchProducts.edges.flatMap(({ node: p }) => p.variants.filter((v) => v.stock > 0).map((v) => <option key={`${p.id}:${v.sku}`} value={JSON.stringify([p.id, v.sku])}>{p.title} · {v.sku} · ${v.price} · {v.stock} disponibles</option>))}</select></label><p className="method-note">Se muestran hasta 20 productos por búsqueda. Los precios y el envío se calculan en el servidor. Crear el pedido reserva inventario y usa las notificaciones configuradas.</p>{items.map((item, i) => <div className="rank-line" key={`${item.productId}:${item.variantSku}`}><span>{item.variantSku}</span><label>Cantidad<input aria-label={`Cantidad ${item.variantSku}`} type="number" min={1} max={99} required value={item.quantity} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x))} /></label><button type="button" onClick={() => setItems(items.filter((_, j) => i !== j))}>Quitar</button></div>)}</>}
    {message && <p role="status">{message}</p>}<button className="publish" disabled={submitting || creating.loading || editing.loading || (!row && !items.length)}>{row ? "Guardar datos" : "Crear y reservar stock"}</button>
  </fieldset></form>;
}
