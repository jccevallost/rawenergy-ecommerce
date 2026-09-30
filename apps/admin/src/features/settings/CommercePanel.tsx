import { ApolloError, useApolloClient, useMutation, useQuery } from "@apollo/client";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Landmark, Tag, Truck, Wallet } from "lucide-react";
import { COMMERCE_SETTINGS, SAVE_COMMERCE_SETTINGS, type CommerceSettings } from "@vital-forge/shared-logic";
import { formatMoney } from "@vital-forge/ui-core";
import { useConfirm } from "../../components/common/ConfirmDialog";
import { useUnsavedChanges } from "../../components/common/UnsavedChanges";
import "./commerce.css";

type Form = Omit<CommerceSettings, "revision" | "updatedByName" | "updatedAt">;
const pick = ({ revision: _r, updatedByName: _u, updatedAt: _a, ...rest }: CommerceSettings): Form => rest;
const errorText = (error: unknown) => {
  if (error instanceof ApolloError) return (error.graphQLErrors[0]?.extensions?.issues as Array<{ message?: string }> | undefined)?.[0]?.message ?? error.graphQLErrors[0]?.message ?? error.message;
  return error instanceof Error ? error.message : "No se pudo guardar.";
};

/** Reglas comerciales que aplica el servidor: cuenta para transferencias, envíos, contra entrega y descuento de bienvenida. */
export function CommercePanel() {
  const client = useApolloClient(), confirm = useConfirm();
  const query = useQuery<{ commerceSettings: CommerceSettings }>(COMMERCE_SETTINGS, { fetchPolicy: "network-only" });
  const [save] = useMutation(SAVE_COMMERCE_SETTINGS);
  const [form, setForm] = useState<Form | null>(null);
  const [message, setMessage] = useState(""), [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false); const saving = useRef(false);
  const settings = query.data?.commerceSettings;
  useEffect(() => { if (settings) setForm(pick(settings)); }, [settings]);
  const dirty = Boolean(form && settings && JSON.stringify(form) !== JSON.stringify(pick(settings)));
  useUnsavedChanges(dirty, { busy });

  if (!form || !settings) return <section className="commerce-panel"><h2>Pagos y envíos</h2><p role="status">{query.error ? errorText(query.error) : "Cargando configuración…"}</p></section>;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => current && { ...current, [key]: value });
  const money = (value: string) => Math.round(Number(value) * 100) / 100;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    const bankChanged = JSON.stringify(form.bank) !== JSON.stringify(settings.bank);
    if (bankChanged && !await confirm({ title: "Cambiar cuenta de cobro", message: `Los clientes verán y transferirán a ${form.bank.name}, cuenta ${form.bank.accountType} ${form.bank.accountNumber}, a nombre de ${form.bank.holder}. Se enviará un aviso al operador. ¿Confirmas?`, confirmLabel: "Sí, cambiar cuenta" })) return;
    saving.current = true; setBusy(true); setMessage(""); setFailure("");
    try {
      await save({ variables: { input: form, revision: settings.revision } });
      await query.refetch();
      await client.refetchQueries({ include: "active" }).catch(() => undefined);
      setMessage("Configuración guardada. La tienda ya usa estos valores.");
    } catch (error) { setFailure(errorText(error)); }
    finally { saving.current = false; setBusy(false); }
  };

  const cod = form.cashOnDelivery;
  const welcome = form.welcomeDiscount;
  return (
    <section className="commerce-panel" aria-labelledby="commerce-title">
      <header>
        <h2 id="commerce-title">Pagos y envíos</h2>
        <p>El servidor aplica estos valores al calcular el carrito y al registrar cada pedido.{settings.updatedByName ? ` Último cambio: ${settings.updatedByName}${settings.updatedAt ? ` · ${new Date(settings.updatedAt).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" })}` : ""}` : " Aún no se han guardado cambios: se muestran los valores iniciales."}</p>
      </header>
      {message && <p className="admin-success" role="status">{message}</p>}
      {failure && <p className="form-error" role="alert">{failure}</p>}
      <form onSubmit={event => void submit(event)}>
        <fieldset disabled={busy} className="commerce-grid">
          <fieldset className="commerce-card">
            <legend><Landmark size={16} /> Cuenta para transferencias</legend>
            <label>Banco<input required minLength={2} maxLength={80} value={form.bank.name} onChange={event => set("bank", { ...form.bank, name: event.target.value })} /></label>
            <label>Tipo de cuenta<select value={form.bank.accountType} onChange={event => set("bank", { ...form.bank, accountType: event.target.value })}><option>Ahorros</option><option>Corriente</option></select></label>
            <label>Número de cuenta<input required inputMode="numeric" pattern="[0-9][0-9-]{4,29}" maxLength={30} value={form.bank.accountNumber} onChange={event => set("bank", { ...form.bank, accountNumber: event.target.value.trim() })} /></label>
            <label>Titular<input required minLength={3} maxLength={80} value={form.bank.holder} onChange={event => set("bank", { ...form.bank, holder: event.target.value })} /></label>
            <label>Cédula o RUC del titular <small>opcional; va en el correo de confirmación</small><input maxLength={20} value={form.bank.document} onChange={event => set("bank", { ...form.bank, document: event.target.value.trim() })} /></label>
            <label className="switch-row"><span><b>Mostrar la cuenta en la web</b><small>Apagado: el cliente la recibe por WhatsApp al terminar su compra.</small></span><input type="checkbox" checked={form.showBankDetails} onChange={event => set("showBankDetails", event.target.checked)} /></label>
          </fieldset>
          <fieldset className="commerce-card">
            <legend><Truck size={16} /> Envíos</legend>
            <label>Express Quito y Valles (USD)<input type="number" min="0" step="0.01" required value={form.shippingFees.EXPRESS_QUITO_VALLES} onChange={event => set("shippingFees", { ...form.shippingFees, EXPRESS_QUITO_VALLES: money(event.target.value) })} /></label>
            <label>Nacional · Servientrega (USD)<input type="number" min="0" step="0.01" required value={form.shippingFees.SERVIENTREGA_NATIONAL} onChange={event => set("shippingFees", { ...form.shippingFees, SERVIENTREGA_NATIONAL: money(event.target.value) })} /></label>
            <label>Envío gratis desde (USD)<input type="number" min="0.01" step="0.01" required value={form.freeShippingThreshold} onChange={event => set("freeShippingThreshold", money(event.target.value))} /></label>
            <fieldset className="free-methods"><legend>Envío gratis en</legend>
              {(["EXPRESS_QUITO_VALLES", "SERVIENTREGA_NATIONAL"] as const).map(method => (
                <label key={method} className="checkbox-label"><input type="checkbox" checked={form.freeShippingMethods.includes(method)} onChange={event => set("freeShippingMethods", event.target.checked ? [...form.freeShippingMethods, method] : form.freeShippingMethods.filter(item => item !== method))} />{method === "EXPRESS_QUITO_VALLES" ? "Express Quito y Valles" : "Nacional · Servientrega"}</label>
              ))}
            </fieldset>
            <p className="commerce-hint">{form.freeShippingMethods.length ? `Con ${formatMoney(form.freeShippingThreshold)} o más de subtotal, gratis en ${form.freeShippingMethods.length > 1 ? "ambos métodos" : form.freeShippingMethods[0] === "EXPRESS_QUITO_VALLES" ? "express" : "el nacional"}; el otro método cobra su tarifa.` : "Ningún envío es gratis."}</p>
          </fieldset>
          <fieldset className="commerce-card">
            <legend><Wallet size={16} /> Pago contra entrega</legend>
            <label className="switch-row"><span><b>Ofrecer contra entrega</b><small>La transferencia siempre está disponible.</small></span><input type="checkbox" checked={cod.enabled} onChange={event => set("cashOnDelivery", { ...cod, enabled: event.target.checked })} /></label>
            <label className="switch-row"><span><b>Solo con envío express</b><small>Quito y Valles.</small></span><input type="checkbox" disabled={!cod.enabled} checked={cod.expressOnly} onChange={event => set("cashOnDelivery", { ...cod, expressOnly: event.target.checked })} /></label>
            <label>Compras de más de (USD) <small>0 = sin mínimo</small><input type="number" min="0" step="0.01" disabled={!cod.enabled} required value={cod.minimumSubtotal} onChange={event => set("cashOnDelivery", { ...cod, minimumSubtotal: money(event.target.value) })} /></label>
            <label>Cancelar si no se confirma por WhatsApp en (horas)<input type="number" min="1" max="72" step="1" disabled={!cod.enabled} required value={cod.confirmHours} onChange={event => set("cashOnDelivery", { ...cod, confirmHours: Math.round(Number(event.target.value)) })} /></label>
            <p className="commerce-hint">{cod.enabled ? `Contra entrega ${cod.expressOnly ? "con envío express" : "en todos los envíos"}, ${cod.minimumSubtotal > 0 ? `en compras de más de ${formatMoney(cod.minimumSubtotal)} (subtotal sin envío)` : "sin monto mínimo"}. El cliente confirma por WhatsApp y envía su ubicación; sin confirmación en ${cod.confirmHours} horas, se cancela solo.` : "Contra entrega desactivado: solo transferencia."}</p>
          </fieldset>
          <fieldset className="commerce-card">
            <legend><Tag size={16} /> Descuento de bienvenida</legend>
            <label className="switch-row"><span><b>Activar el código</b><small>Solo en la primera compra: el servidor rechaza documentos, celulares o correos que ya compraron.</small></span><input type="checkbox" checked={welcome.enabled} onChange={event => set("welcomeDiscount", { ...welcome, enabled: event.target.checked })} /></label>
            <label>Código <small>4 a 20 letras, números o guiones</small><input required pattern="[A-Za-z0-9-]{4,20}" maxLength={20} disabled={!welcome.enabled} value={welcome.code} onChange={event => set("welcomeDiscount", { ...welcome, code: event.target.value.toUpperCase().replace(/\s/g, "") })} /></label>
            <label>Descuento (%)<input type="number" min="1" max="50" step="1" required disabled={!welcome.enabled} value={welcome.percent} onChange={event => set("welcomeDiscount", { ...welcome, percent: Math.round(Number(event.target.value)) })} /></label>
            <label>Compra mínima de productos (USD) <small>0 = sin mínimo</small><input type="number" min="0" step="0.01" required disabled={!welcome.enabled} value={welcome.minimumSubtotal} onChange={event => set("welcomeDiscount", { ...welcome, minimumSubtotal: money(event.target.value) })} /></label>
            <label>Válido hasta <small>vacío = sin fecha de fin</small><input type="date" disabled={!welcome.enabled} value={welcome.endsOn ?? ""} onChange={event => set("welcomeDiscount", { ...welcome, endsOn: event.target.value || null })} /></label>
            <label className="switch-row"><span><b>Anunciar el código en la tienda</b><small>Apagado: el código se reparte por WhatsApp o redes; la tienda solo muestra el campo para escribirlo.</small></span><input type="checkbox" disabled={!welcome.enabled} checked={welcome.showOnStore} onChange={event => set("welcomeDiscount", { ...welcome, showOnStore: event.target.checked })} /></label>
            <p className="commerce-hint">{welcome.enabled ? `${welcome.percent} % sobre los productos con el código ${welcome.code}${welcome.minimumSubtotal > 0 ? `, en compras desde ${formatMoney(welcome.minimumSubtotal)}` : ""}${welcome.endsOn ? `, hasta el ${welcome.endsOn}` : ""}. Una vez por persona; si el pedido se cancela, vuelve a quedar disponible. El envío gratis se calcula con el total ya descontado.` : "Descuento desactivado: la tienda no acepta el código."}</p>
          </fieldset>
        </fieldset>
        <div className="dialog-actions">
          <button type="button" disabled={!dirty || busy} onClick={() => setForm(pick(settings))}>Descartar cambios</button>
          <button className="primary-button" disabled={!dirty || busy}>{busy ? "Guardando…" : "Guardar pagos y envíos"}</button>
        </div>
      </form>
    </section>
  );
}
