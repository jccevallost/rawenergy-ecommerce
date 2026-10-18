import type { ReactNode } from "react";
import type { CustomerProfile } from "@vital-forge/shared-logic";
import { cantonLabel, ECUADOR, findProvince, ID_TYPES, type IdType, idTypeLabel } from "../../lib/ecuador";

// CU08: entrega con los datos guardados de la cuenta. Muestra resúmenes y pide solo lo que falta o lo que la
// persona quiere cambiar. Los campos que pueden tener error usan los mismos id que el formulario de invitado
// (`checkout-*`), así el foco al primer error funciona igual.
export type SavedChoice = {
  /** id de una dirección guardada o "new" para escribir otra. */
  addressId: string;
  otherRecipient: boolean; recipientName: string; recipientPhone: string;
  changeBilling: boolean; billingName: string;
  savePhone: boolean; saveBilling: boolean; saveAddress: boolean; addressLabel: string;
};
export type SavedForm = { phone: string; idType: IdType; idNumber: string; province: string; city: string; address: string; reference: string };

export const initialChoice = (profile: CustomerProfile): SavedChoice => ({
  addressId: profile.defaultAddressId ?? profile.addresses[0]?.id ?? "new",
  otherRecipient: false, recipientName: "", recipientPhone: "",
  changeBilling: !profile.billing, billingName: profile.billing?.name ?? profile.name,
  savePhone: false, saveBilling: false, saveAddress: false, addressLabel: ""
});

type Props = {
  profile: CustomerProfile;
  choice: SavedChoice;
  form: SavedForm;
  errors: Record<string, string>;
  onChoice: (patch: Partial<SavedChoice>) => void;
  onForm: <K extends keyof SavedForm>(key: K, value: SavedForm[K]) => void;
};

const error = (errors: Record<string, string>, key: string) => errors[key] ? <small id={`error-${key}`} className="field-error">{errors[key]}</small> : null;
const field = (errors: Record<string, string>, key: string) => ({ id: `checkout-${key}`, "aria-invalid": errors[key] ? true : undefined, "aria-describedby": errors[key] ? `error-${key}` : undefined });

function Block({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="saved-block" aria-label={title}><div className="saved-block-head"><h3>{title}</h3>{action}</div>{children}</section>;
}

export function SavedDetails({ profile, choice, form, errors, onChoice, onForm }: Props) {
  const cantons = findProvince(form.province)?.cantons ?? [];
  const typing = choice.addressId === "new";
  return (
    <div className="saved-details">
      <Block title="Tus datos">
        <p>{profile.name} · {profile.email}{profile.phone && <> · {profile.phone}</>}</p>
        {!profile.phone && <>
          <label className="field"><span>Celular (WhatsApp)</span><input {...field(errors, "phone")} type="tel" inputMode="tel" autoComplete="tel-national" maxLength={17} placeholder="0991234567" value={form.phone} onChange={event => onForm("phone", event.target.value.replace(/[^\d+ -]/g, ""))} required />{error(errors, "phone")}<small className="field-help">Lo usamos para coordinar la entrega por WhatsApp.</small></label>
          <label className="choice"><input type="checkbox" checked={choice.savePhone} onChange={event => onChoice({ savePhone: event.target.checked })} /><span><b>Guardar este celular en mi cuenta</b></span></label>
        </>}
      </Block>

      <Block title="Factura" action={profile.billing && !choice.changeBilling ? <button type="button" className="btn-link" onClick={() => onChoice({ changeBilling: true })} aria-label="Cambiar los datos de factura de este pedido">Cambiar</button> : undefined}>
        {profile.billing && !choice.changeBilling
          ? <p>{profile.billing.name} · {idTypeLabel(profile.billing.idType as IdType)} {profile.billing.idNumber}</p>
          : <div className="form-grid">
              <label className="field full"><span>A nombre de</span><input {...field(errors, "billingName")} autoComplete="name" maxLength={100} value={choice.billingName} onChange={event => onChoice({ billingName: event.target.value })} required />{error(errors, "billingName")}</label>
              <label className="field"><span>Tipo de documento</span><select id="checkout-idType" value={form.idType} onChange={event => onForm("idType", event.target.value as IdType)}>
                {ID_TYPES.map(([value, label]) => <option key={value} value={value}>{label}{value === "PASAPORTE" ? " (extranjeros)" : ""}</option>)}
              </select></label>
              <label className="field"><span>Número</span><input {...field(errors, "idNumber")} inputMode={form.idType === "PASAPORTE" ? "text" : "numeric"} autoComplete="off" maxLength={form.idType === "PASAPORTE" ? 20 : form.idType === "RUC" ? 13 : 10} value={form.idNumber} onChange={event => onForm("idNumber", form.idType === "PASAPORTE" ? event.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, "") : event.target.value.replace(/\D/g, ""))} required />{error(errors, "idNumber")}</label>
              <label className="choice full"><input type="checkbox" checked={choice.saveBilling} onChange={event => onChoice({ saveBilling: event.target.checked })} /><span><b>Guardar para mis próximas compras</b><small>Si no lo marcas, solo se usa en este pedido.</small></span></label>
            </div>}
      </Block>

      <Block title="Entrega">
        <fieldset className="saved-addresses">
          <legend className="sr-only">Dirección de entrega</legend>
          {profile.addresses.map(address => (
            <label key={address.id} className="choice address-choice">
              <input type="radio" name="savedAddress" checked={choice.addressId === address.id} onChange={() => onChoice({ addressId: address.id })} />
              <span><b>{address.label}{address.isDefault && <small className="badge badge-success">Predeterminada</small>}</b><span>{address.address}</span><small>{address.city}, {address.province}{address.recipientName ? ` · Recibe ${address.recipientName}` : ""}</small></span>
            </label>
          ))}
          <label className="choice address-choice">
            <input type="radio" name="savedAddress" checked={typing} onChange={() => onChoice({ addressId: "new" })} />
            <span><b>{profile.addresses.length ? "Otra dirección" : "Escribir la dirección"}</b><small>Solo para este pedido, salvo que la guardes.</small></span>
          </label>
        </fieldset>
        {errors.deliveryAddressId && <p id="error-deliveryAddressId" className="field-error" role="alert">{errors.deliveryAddressId}</p>}
        {typing && <div className="form-grid">
          <label className="field"><span>Provincia</span><select {...field(errors, "province")} autoComplete="address-level1" value={form.province} onChange={event => onForm("province", event.target.value)} required>
            <option value="" disabled>Elige la provincia</option>
            {ECUADOR.map(entry => <option key={entry.province} value={entry.province}>{entry.province}</option>)}
          </select>{error(errors, "province")}</label>
          <label className="field"><span>Ciudad (cantón)</span><select {...field(errors, "city")} autoComplete="address-level2" value={form.city} disabled={!cantons.length} onChange={event => onForm("city", event.target.value)} required>
            <option value="" disabled>{cantons.length ? "Elige la ciudad" : "Primero elige la provincia"}</option>
            {cantons.map(canton => <option key={canton[0]} value={canton[0]}>{cantonLabel(canton)}</option>)}
          </select>{error(errors, "city")}</label>
          <label className="field full"><span>Dirección exacta</span><input {...field(errors, "address")} autoComplete="street-address" maxLength={240} value={form.address} onChange={event => onForm("address", event.target.value)} placeholder="Calle principal, número y calle secundaria" required />{error(errors, "address")}</label>
          <label className="field full"><span>Referencia (opcional)</span><input id="checkout-reference" maxLength={180} value={form.reference} onChange={event => onForm("reference", event.target.value)} placeholder="Casa, edificio, local, horarios" /></label>
          <label className="choice full"><input type="checkbox" checked={choice.saveAddress} onChange={event => onChoice({ saveAddress: event.target.checked })} /><span><b>Guardar en mis direcciones</b></span></label>
          {choice.saveAddress && <label className="field full"><span>Nombre de la dirección</span><input {...field(errors, "addressLabel")} maxLength={40} placeholder="Casa, Oficina, Gimnasio" value={choice.addressLabel} onChange={event => onChoice({ addressLabel: event.target.value })} />{error(errors, "addressLabel")}</label>}
        </div>}
        <label className="choice"><input type="checkbox" checked={choice.otherRecipient} onChange={event => onChoice({ otherRecipient: event.target.checked })} /><span><b>La recibe otra persona</b><small>Tus datos y la factura no cambian.</small></span></label>
        {choice.otherRecipient && <div className="form-grid">
          <label className="field"><span>Nombre de quien recibe</span><input {...field(errors, "recipientName")} autoComplete="off" maxLength={100} value={choice.recipientName} onChange={event => onChoice({ recipientName: event.target.value })} required />{error(errors, "recipientName")}</label>
          <label className="field"><span>Celular de quien recibe</span><input {...field(errors, "recipientPhone")} type="tel" inputMode="tel" autoComplete="off" maxLength={17} value={choice.recipientPhone} onChange={event => onChoice({ recipientPhone: event.target.value.replace(/[^\d+ -]/g, "") })} required />{error(errors, "recipientPhone")}</label>
        </div>}
      </Block>
    </div>
  );
}
