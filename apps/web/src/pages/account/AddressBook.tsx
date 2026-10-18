import { type FormEvent, useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { ADD_MY_ADDRESS, type CustomerAddress, type CustomerProfile, REMOVE_MY_ADDRESS, SET_MY_DEFAULT_ADDRESS, UPDATE_MY_ADDRESS } from "@vital-forge/shared-logic";
import { cantonLabel, ECUADOR, findProvince, mobileProblem } from "../../lib/ecuador";
import { focusFirstError, SaveStatus, SelectField, TextField } from "./fields";
import { useProfileSave } from "./useProfileSave";

type AddResult = { addMyAddress: { addressId: string; duplicate: boolean; madeDefault: boolean; profile: CustomerProfile } };
type Draft = { label: string; province: string; city: string; address: string; reference: string; otherRecipient: boolean; recipientName: string; recipientPhone: string; makeDefault: boolean };
const ORDER = ["label", "province", "city", "address", "reference", "recipientName", "recipientPhone"];
const empty: Draft = { label: "", province: "", city: "", address: "", reference: "", otherRecipient: false, recipientName: "", recipientPhone: "", makeDefault: false };
const fromAddress = (a: CustomerAddress): Draft => ({ label: a.label, province: a.province, city: a.city, address: a.address, reference: a.reference, otherRecipient: Boolean(a.recipientName), recipientName: a.recipientName, recipientPhone: a.recipientPhone, makeDefault: a.isDefault });

/** Guía en el navegador; el servidor vuelve a validar todo (plan §5.2). */
function problems(draft: Draft) {
  const found: Record<string, string> = {};
  if (!draft.label.trim()) found.label = "Ponle un nombre, por ejemplo Casa u Oficina.";
  if (!draft.province) found.province = "Elige la provincia.";
  if (!draft.city) found.city = "Elige la ciudad (cantón).";
  if (draft.address.trim().length < 8) found.address = "Escribe la dirección con calle, número e intersección (al menos 8 caracteres).";
  if (draft.otherRecipient) {
    if (draft.recipientName.trim().length < 3) found.recipientName = "Escribe el nombre de quien recibe.";
    const phone = mobileProblem(draft.recipientPhone);
    if (phone) found.recipientPhone = phone;
  }
  return found;
}

function AddressForm({ profile, editing, onDone, onCancel }: { profile: CustomerProfile; editing: CustomerAddress | null; onDone: (message: string) => void; onCancel: () => void }) {
  const save = useProfileSave();
  const [draft, setDraft] = useState<Draft>(editing ? fromAddress(editing) : empty);
  const cantons = findProvince(draft.province)?.cantons ?? [];
  const prefix = editing ? `address-${editing.id}` : "address-new";
  useEffect(() => { document.getElementById(`${prefix}-label`)?.focus(); }, [prefix]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value, ...(key === "province" ? { city: "" } : {}) }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (save.status === "saving") return;
    const found = problems(draft);
    if (Object.keys(found).length) { save.setFields(found); focusFirstError(prefix, ORDER, found); return; }
    const input = { label: draft.label, province: draft.province, city: draft.city, address: draft.address, reference: draft.reference, recipientName: draft.otherRecipient ? draft.recipientName : "", recipientPhone: draft.otherRecipient ? draft.recipientPhone : "" };
    const added = (data: AddResult) => data.addMyAddress.duplicate ? "Ya tenías esta dirección guardada; no la duplicamos."
      : data.addMyAddress.madeDefault ? "Dirección agregada. Usaremos esta dirección para tus próximas compras." : "Dirección agregada.";
    if (editing) {
      const result = await save.save<{ updateMyAddress: CustomerProfile }>(UPDATE_MY_ADDRESS, { id: editing.id, input, revision: profile.revision }, data => data.updateMyAddress, "Dirección actualizada.");
      if (result.data) onDone("Dirección actualizada."); else focusFirstError(prefix, ORDER, result.fields);
      return;
    }
    const result = await save.save<AddResult>(ADD_MY_ADDRESS, { input, revision: profile.revision, makeDefault: draft.makeDefault }, data => data.addMyAddress.profile, added);
    if (result.data) onDone(added(result.data)); else focusFirstError(prefix, ORDER, result.fields);
  };

  const first = !profile.addresses.length;
  return (
    <form className="form-grid account-form" onSubmit={submit} noValidate aria-labelledby={`${prefix}-title`}>
      <h3 id={`${prefix}-title`}>{editing ? `Editar «${editing.label}»` : "Nueva dirección"}</h3>
      <TextField id={`${prefix}-label`} label="Nombre de la dirección" placeholder="Casa, Oficina, Gimnasio" maxLength={40} value={draft.label} error={save.fields.label} onChange={event => set("label", event.target.value)} required />
      <SelectField id={`${prefix}-province`} label="Provincia" autoComplete="address-level1" value={draft.province} error={save.fields.province} onChange={event => set("province", event.target.value)} required>
        <option value="" disabled>Elige la provincia</option>
        {ECUADOR.map(entry => <option key={entry.province} value={entry.province}>{entry.province}</option>)}
      </SelectField>
      <SelectField id={`${prefix}-city`} label="Ciudad (cantón)" autoComplete="address-level2" value={draft.city} disabled={!cantons.length} error={save.fields.city} onChange={event => set("city", event.target.value)} required>
        <option value="" disabled>{cantons.length ? "Elige la ciudad" : "Primero elige la provincia"}</option>
        {cantons.map(canton => <option key={canton[0]} value={canton[0]}>{cantonLabel(canton)}</option>)}
      </SelectField>
      <TextField id={`${prefix}-address`} label="Dirección" autoComplete="street-address" maxLength={240} value={draft.address} error={save.fields.address} help="Calle principal, número y calle secundaria." onChange={event => set("address", event.target.value)} required />
      <TextField id={`${prefix}-reference`} label="Referencia (opcional)" maxLength={180} value={draft.reference} error={save.fields.reference} help="Por ejemplo: edificio azul, junto a la farmacia." onChange={event => set("reference", event.target.value)} />
      <label className="choice"><input type="checkbox" checked={draft.otherRecipient} onChange={event => set("otherRecipient", event.target.checked)} /><span><b>La recibe otra persona</b><small>Si la dejas sin marcar, la recibes tú.</small></span></label>
      {draft.otherRecipient && <>
        <TextField id={`${prefix}-recipientName`} label="Nombre de quien recibe" autoComplete="off" maxLength={100} value={draft.recipientName} error={save.fields.recipientName} onChange={event => set("recipientName", event.target.value)} required />
        <TextField id={`${prefix}-recipientPhone`} label="Celular de quien recibe" type="tel" inputMode="tel" autoComplete="off" maxLength={30} value={draft.recipientPhone} error={save.fields.recipientPhone} onChange={event => set("recipientPhone", event.target.value)} required />
      </>}
      {!editing && (first
        ? <p className="field-help">Será tu dirección predeterminada: la usaremos en tus próximas compras y podrás cambiarla.</p>
        : <label className="choice"><input type="checkbox" checked={draft.makeDefault} onChange={event => set("makeDefault", event.target.checked)} /><span><b>Usarla como predeterminada</b><small>La elegimos primero al comprar.</small></span></label>)}
      <SaveStatus state={save} />
      <div className="account-form-actions">
        <button className="btn btn-primary" disabled={save.status === "saving"}>{save.status === "saving" ? "Guardando…" : editing ? "Guardar cambios" : "Guardar dirección"}</button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

/** Confirmación de borrado. Si es la predeterminada y hay otras, se elige la siguiente o ninguna (plan §5.1). */
function RemoveAddress({ profile, address, onDone, onCancel }: { profile: CustomerProfile; address: CustomerAddress; onDone: (message: string) => void; onCancel: () => void }) {
  const save = useProfileSave();
  const others = profile.addresses.filter(a => a.id !== address.id);
  const mustChoose = address.isDefault && others.length > 0;
  const [next, setNext] = useState(mustChoose ? others[0]!.id : "");
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => { confirm.current?.focus(); }, []);
  const remove = async () => {
    const result = await save.save<{ removeMyAddress: CustomerProfile }>(REMOVE_MY_ADDRESS, { id: address.id, revision: profile.revision, ...(mustChoose ? { nextDefaultId: next || null } : {}) }, data => data.removeMyAddress, "Dirección eliminada.");
    if (result.data) onDone(`Eliminamos «${address.label}». Los pedidos que ya hiciste conservan su dirección.`);
  };
  return (
    <div className="remove-confirm" role="group" aria-labelledby={`remove-${address.id}`}>
      <p id={`remove-${address.id}`}><b>¿Eliminar «{address.label}»?</b> Los pedidos que ya hiciste conservan su dirección.</p>
      {mustChoose && <SelectField id={`remove-${address.id}-next`} label="Es tu dirección predeterminada. ¿Cuál usamos ahora?" value={next} onChange={event => setNext(event.target.value)}>
        {others.map(a => <option key={a.id} value={a.id}>{a.label} — {a.address}</option>)}
        <option value="">Ninguna por ahora</option>
      </SelectField>}
      <SaveStatus state={save} />
      <div className="account-form-actions">
        <button type="button" ref={confirm} className="btn btn-danger" onClick={() => void remove()} disabled={save.status === "saving"}>{save.status === "saving" ? "Eliminando…" : "Eliminar"}</button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

/** CU06: libreta de direcciones como tarjetas, con alta, edición, predeterminada y borrado. */
export function AddressBook({ profile }: { profile: CustomerProfile }) {
  const [mode, setMode] = useState<{ kind: "add" } | { kind: "edit" | "remove"; id: string } | null>(null);
  const [message, setMessage] = useState("");
  const save = useProfileSave();
  const addButton = useRef<HTMLButtonElement>(null);
  const full = profile.addresses.length >= profile.maxAddresses;
  const finish = (text: string) => { setMode(null); setMessage(text); requestAnimationFrame(() => document.getElementById("addresses-status")?.focus()); };
  const cancel = () => { setMode(null); requestAnimationFrame(() => addButton.current?.focus()); };
  const makeDefault = async (address: CustomerAddress) => {
    setMessage("");
    const result = await save.save<{ setMyDefaultAddress: CustomerProfile }>(SET_MY_DEFAULT_ADDRESS, { id: address.id, revision: profile.revision }, data => data.setMyDefaultAddress, `Usaremos «${address.label}» para tus próximas compras.`);
    if (result.data) requestAnimationFrame(() => document.getElementById("addresses-status")?.focus());
  };
  const status = message || (save.status === "saved" ? save.message : "");

  return (
    <div className="address-book">
      <p id="addresses-status" className={status ? "notice notice-success" : "sr-only"} role="status" tabIndex={-1}>{status}</p>
      {save.status !== "saved" && <SaveStatus state={save} />}
      {!profile.addresses.length && mode?.kind !== "add" && (
        <div className="empty-cart"><MapPin size={32} aria-hidden="true" /><h2>Todavía no tienes direcciones</h2><p>Guarda una para comprar sin volver a escribirla.</p></div>
      )}
      <ul className="address-list">
        {profile.addresses.map(address => (
          <li key={address.id} className={`account-card ${address.isDefault ? "is-default" : ""}`}>
            {mode && mode.kind === "edit" && mode.id === address.id
              ? <AddressForm profile={profile} editing={address} onDone={finish} onCancel={cancel} />
              : <>
                  <h2>{address.label}{address.isDefault && <span className="badge badge-success">Predeterminada</span>}</h2>
                  <p>{address.address}{address.reference && <><br /><small className="muted">Referencia: {address.reference}</small></>}</p>
                  <p className="muted">{address.city}, {address.province}</p>
                  <p className="muted">Recibe: {address.recipientName ? `${address.recipientName} · ${address.recipientPhone}` : "tú"}</p>
                  {mode && mode.kind === "remove" && mode.id === address.id
                    ? <RemoveAddress profile={profile} address={address} onDone={finish} onCancel={cancel} />
                    : <div className="account-form-actions">
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => { setMessage(""); setMode({ kind: "edit", id: address.id }); }} aria-label={`Editar ${address.label}`}>Editar</button>
                        {!address.isDefault && <button type="button" className="btn btn-outline btn-sm" onClick={() => void makeDefault(address)} disabled={save.status === "saving"} aria-label={`Usar ${address.label} como predeterminada`}>Usar como predeterminada</button>}
                        <button type="button" className="btn-link" onClick={() => { setMessage(""); setMode({ kind: "remove", id: address.id }); }} aria-label={`Eliminar ${address.label}`}>Eliminar</button>
                      </div>}
                </>}
          </li>
        ))}
      </ul>
      {mode?.kind === "add"
        ? <div className="account-card"><AddressForm profile={profile} editing={null} onDone={finish} onCancel={cancel} /></div>
        : <div className="account-form-actions">
            <button type="button" ref={addButton} className="btn btn-primary" disabled={full} onClick={() => { setMessage(""); setMode({ kind: "add" }); }}>Agregar dirección</button>
            {full && <p className="field-help">Tienes {profile.maxAddresses} direcciones, el máximo. Elimina una para agregar otra.</p>}
          </div>}
    </div>
  );
}
