import { type FormEvent, useEffect, useRef, useState } from "react";
import { type CustomerProfile, UPDATE_MY_BILLING, UPDATE_MY_CONTACT } from "@vital-forge/shared-logic";
import { emailProblem, ID_TYPES, type IdType, identificationProblem, idTypeLabel, inferIdType, mobileProblem } from "../../lib/ecuador";
import { focusFirstError, SaveStatus, SelectField, TextField } from "./fields";
import { useProfileSave } from "./useProfileSave";

type ContactResult = { updateMyContact: CustomerProfile };
type BillingResult = { updateMyBilling: CustomerProfile };

/** Botón «Editar» que recupera el foco al cerrar el formulario. */
function useEditing() {
  const [editing, setEditing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  // Al cerrar el formulario el botón vuelve a montarse; el foco se le da cuando ya existe.
  const was = useRef(false);
  useEffect(() => { if (was.current && !editing) button.current?.focus(); was.current = editing; }, [editing]);
  const close = () => setEditing(false);
  return { editing, open: () => setEditing(true), close, button };
}

/** CU06: nombre y celulares. El correo de acceso se cambia en Seguridad, con confirmación. */
export function ContactBlock({ profile }: { profile: CustomerProfile }) {
  const { editing, open, close, button } = useEditing();
  const save = useProfileSave();
  const [form, setForm] = useState({ name: profile.name, phone: profile.phone, altPhone: profile.altPhone });
  useEffect(() => { if (editing) document.getElementById("contact-name")?.focus(); }, [editing]);
  const start = () => { setForm({ name: profile.name, phone: profile.phone, altPhone: profile.altPhone }); save.reset(); open(); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (save.status === "saving") return;
    const found: Record<string, string> = {};
    if (form.name.trim().length < 3) found.name = "Escribe tu nombre completo (al menos 3 caracteres).";
    if (form.phone.trim() && mobileProblem(form.phone)) found.phone = mobileProblem(form.phone)!;
    if (form.altPhone.trim() && mobileProblem(form.altPhone)) found.altPhone = mobileProblem(form.altPhone)!;
    if (Object.keys(found).length) { save.setFields(found); focusFirstError("contact", ["name", "phone", "altPhone"], found); return; }
    const result = await save.save<ContactResult>(UPDATE_MY_CONTACT, { input: { name: form.name, phone: form.phone, altPhone: form.altPhone }, revision: profile.revision }, data => data.updateMyContact, "Guardamos tus datos.");
    if (result.data) close();
    else focusFirstError("contact", ["name", "phone", "altPhone"], result.fields);
  };

  return (
    <section className="account-card" aria-labelledby="account-contact">
      <div className="account-card-head">
        <h2 id="account-contact">Datos personales</h2>
        {!editing && <button type="button" ref={button} className="btn btn-outline btn-sm" onClick={start} aria-label="Editar datos personales">Editar</button>}
      </div>
      {!editing ? (
        <dl className="account-data">
          <div><dt>Nombre</dt><dd>{profile.name}</dd></div>
          <div><dt>Correo de acceso</dt><dd>{profile.email}</dd></div>
          <div><dt>Celular</dt><dd>{profile.phone || "Sin registrar"}</dd></div>
          <div><dt>Celular alternativo</dt><dd>{profile.altPhone || "Sin registrar"}</dd></div>
        </dl>
      ) : (
        <form className="form-grid account-form" onSubmit={submit} noValidate>
          <TextField id="contact-name" label="Nombre completo" autoComplete="name" maxLength={100} value={form.name} error={save.fields.name} onChange={event => setForm({ ...form, name: event.target.value })} required />
          <TextField id="contact-phone" label="Celular" type="tel" inputMode="tel" autoComplete="tel-national" maxLength={30} value={form.phone} error={save.fields.phone} help="10 dígitos, empieza con 09. Lo usamos para coordinar la entrega." onChange={event => setForm({ ...form, phone: event.target.value })} />
          <TextField id="contact-altPhone" label="Celular alternativo (opcional)" type="tel" inputMode="tel" autoComplete="off" maxLength={30} value={form.altPhone} error={save.fields.altPhone} onChange={event => setForm({ ...form, altPhone: event.target.value })} />
          <SaveStatus state={save} />
          <div className="account-form-actions">
            <button className="btn btn-primary" disabled={save.status === "saving"}>{save.status === "saving" ? "Guardando…" : "Guardar"}</button>
            <button type="button" className="btn btn-outline" onClick={() => { save.reset(); close(); }}>Cancelar</button>
          </div>
        </form>
      )}
      {!editing && <SaveStatus state={save} />}
    </section>
  );
}

/** CU06: datos de factura propios o, si no hay, los del titular al comprar. */
export function BillingBlock({ profile }: { profile: CustomerProfile }) {
  const { editing, open, close, button } = useEditing();
  const save = useProfileSave();
  const initial = () => ({ name: profile.billing?.name ?? profile.name, idType: (profile.billing?.idType ?? "CEDULA") as IdType, idNumber: profile.billing?.idNumber ?? "", email: profile.billing?.email ?? "" });
  const [form, setForm] = useState(initial);
  useEffect(() => { if (editing) document.getElementById("billing-name")?.focus(); }, [editing]);
  const start = () => { setForm(initial()); save.reset(); open(); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (save.status === "saving") return;
    const found: Record<string, string> = {};
    if (form.name.trim().length < 3) found.name = "Escribe el nombre o razón social (al menos 3 caracteres).";
    const idIssue = identificationProblem(form.idType, form.idNumber);
    if (idIssue) found.idNumber = idIssue;
    if (form.email.trim() && emailProblem(form.email)) found.email = emailProblem(form.email)!;
    if (Object.keys(found).length) { save.setFields(found); focusFirstError("billing", ["name", "idNumber", "email"], found); return; }
    const result = await save.save<BillingResult>(UPDATE_MY_BILLING, { input: { ...form, email: form.email.trim() }, revision: profile.revision }, data => data.updateMyBilling, "Guardamos tus datos de factura.");
    if (result.data) close();
    else focusFirstError("billing", ["name", "idType", "idNumber", "email"], result.fields);
  };
  const clear = async () => {
    await save.save<BillingResult>(UPDATE_MY_BILLING, { input: null, revision: profile.revision }, data => data.updateMyBilling, "Usaremos tu nombre al facturar; te pediremos la identificación al comprar.");
  };

  return (
    <section className="account-card" aria-labelledby="account-billing">
      <div className="account-card-head">
        <h2 id="account-billing">Datos de factura</h2>
        {!editing && <button type="button" ref={button} className="btn btn-outline btn-sm" onClick={start} aria-label={profile.billing ? "Editar datos de factura" : "Agregar datos de factura"}>{profile.billing ? "Editar" : "Agregar"}</button>}
      </div>
      {!editing ? (profile.billing
        ? <>
            <dl className="account-data">
              <div><dt>A nombre de</dt><dd>{profile.billing.name}</dd></div>
              <div><dt>{idTypeLabel(profile.billing.idType as IdType)}</dt><dd>{profile.billing.idNumber}</dd></div>
              {profile.billing.email && <div><dt>Correo para la factura</dt><dd>{profile.billing.email}</dd></div>}
            </dl>
            <button type="button" className="btn-link" onClick={() => void clear()} disabled={save.status === "saving"}>Quitar estos datos de factura</button>
          </>
        : <p className="muted">Sin registrar. Guárdalos para no escribirlos en cada compra; la identificación es obligatoria para facturar.</p>
      ) : (
        <form className="form-grid account-form" onSubmit={submit} noValidate>
          <TextField id="billing-name" label="Nombre o razón social" autoComplete="name" maxLength={100} value={form.name} error={save.fields.name} onChange={event => setForm({ ...form, name: event.target.value })} required />
          <SelectField id="billing-idType" label="Tipo de identificación" value={form.idType} error={save.fields.idType} onChange={event => setForm({ ...form, idType: event.target.value as IdType })}>
            {ID_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </SelectField>
          <TextField id="billing-idNumber" label="Número de identificación" inputMode={form.idType === "PASAPORTE" ? "text" : "numeric"} autoComplete="off" maxLength={30} value={form.idNumber} error={save.fields.idNumber}
            help="Solo para la factura. No la compartimos ni la usamos para buscarte." onChange={event => { const idNumber = event.target.value; setForm(current => ({ ...current, idNumber, idType: current.idType === "PASAPORTE" ? current.idType : inferIdType(idNumber) ?? current.idType })); }} required />
          <TextField id="billing-email" label="Correo para la factura (opcional)" type="email" inputMode="email" autoComplete="email" maxLength={120} value={form.email} error={save.fields.email} help="Si lo dejas vacío, usamos tu correo de acceso." onChange={event => setForm({ ...form, email: event.target.value })} />
          <SaveStatus state={save} />
          <div className="account-form-actions">
            <button className="btn btn-primary" disabled={save.status === "saving"}>{save.status === "saving" ? "Guardando…" : "Guardar"}</button>
            <button type="button" className="btn btn-outline" onClick={() => { save.reset(); close(); }}>Cancelar</button>
          </div>
        </form>
      )}
      {!editing && <SaveStatus state={save} />}
    </section>
  );
}
