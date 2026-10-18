import { randomUUID } from "node:crypto";
import { GraphQLError } from "graphql";
import { z } from "zod";
import { operationContext, registerMemoryStore, unitOfWork } from "../lib/unitOfWork.js";
import { usesMongo } from "../lib/persistence.js";
import { CustomerProfileModel } from "../models/CustomerProfile.js";
import { addressFingerprint, addressInputSchema, billingInputSchema, contactInputSchema, MAX_CUSTOMER_ADDRESSES } from "../validation/customerProfile.js";
import { authService, type AuthUser } from "./auth.service.js";

// CU03: perfil y libreta de direcciones del cliente (plan de cuenta, §5). Reglas:
// - El dueño sale siempre de la sesión; ningún id enviado concede propiedad.
// - Cada escritura exige la revisión leída: dos pestañas no se pisan en silencio.
// - Un perfil ausente equivale a la revisión 0 sin datos; se crea en la primera escritura.
// - La primera dirección queda predeterminada; borrar la predeterminada exige elegir la siguiente o ninguna.

type Address = { id: string; label: string; province: string; city: string; address: string; reference: string; recipientName: string; recipientPhone: string; fingerprint: string; createdAt: string; updatedAt: string };
type Billing = { name: string; idType: string; idNumber: string; email: string };
type StoredProfile = { id: string; revision: number; phone: string; altPhone: string; billing: Billing | null; addresses: Address[]; defaultAddressId: string | null; createdAt: string; updatedAt: string };

let memory: StoredProfile[] = [];
registerMemoryStore(() => memory, value => { memory = value; });

const conflict = () => new GraphQLError("Tus datos cambiaron en otra pestaña o dispositivo. Revisa la versión actual antes de guardar.", { extensions: { code: "CONFLICT" } });
const fieldError = (field: string, message: string) => new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT", field } });
// Misma respuesta para una dirección inexistente o ajena (plan §9).
const addressNotFound = () => fieldError("addressId", "No encontramos esa dirección en tu cuenta.");
const revisionSchema = z.number().int().min(0).max(1_000_000);
const idSchema = z.string().uuid();
const iso = (value: unknown) => new Date(value as string | Date).toISOString();

const normalize = (row: any): StoredProfile => ({
  id: String(row._id ?? row.id), revision: row.revision, phone: row.phone ?? "", altPhone: row.altPhone ?? "",
  billing: row.billing?.idNumber ? { name: row.billing.name, idType: row.billing.idType, idNumber: row.billing.idNumber, email: row.billing.email ?? "" } : null,
  addresses: (row.addresses ?? []).map((a: any) => ({ ...a, reference: a.reference ?? "", recipientName: a.recipientName ?? "", recipientPhone: a.recipientPhone ?? "", createdAt: iso(a.createdAt), updatedAt: iso(a.updatedAt) })),
  defaultAddressId: row.defaultAddressId ?? null, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt)
});

async function load(userId: string): Promise<StoredProfile | null> {
  if (usesMongo()) { const row = await CustomerProfileModel.findById(userId).lean(); return row ? normalize(row) : null; }
  const row = memory.find(p => p.id === userId);
  return row ? structuredClone(row) : null;
}

/** Escritura condicionada a la revisión leída. 0 = el perfil aún no existe. */
async function persist(userId: string, expected: number, next: StoredProfile) {
  if (usesMongo()) {
    if (expected === 0) {
      try { await CustomerProfileModel.create([{ ...next, _id: userId }]); }
      catch (error) { if ((error as { code?: number }).code === 11000) throw conflict(); throw error; }
      return;
    }
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...fields } = next;
    const result = await CustomerProfileModel.updateOne({ _id: userId, revision: expected }, { $set: fields });
    if (!result.matchedCount) throw conflict();
    return;
  }
  const index = memory.findIndex(p => p.id === userId);
  if (expected === 0) { if (index >= 0) throw conflict(); memory.push(next); return; }
  if (index < 0 || memory[index]!.revision !== expected) throw conflict();
  memory[index] = next;
}

const empty = (userId: string): StoredProfile => { const now = new Date().toISOString(); return { id: userId, revision: 0, phone: "", altPhone: "", billing: null, addresses: [], defaultAddressId: null, createdAt: now, updatedAt: now }; };

/** Vista para el cliente. Sin la huella interna; `missing` dice qué falta para comprar sin escribir. */
function view(user: AuthUser, profile: StoredProfile) {
  const addresses = profile.addresses.map(({ fingerprint: _fingerprint, ...address }) => ({ ...address, isDefault: address.id === profile.defaultAddressId }));
  const missing = [
    ...(!profile.phone ? ["phone"] : []),
    ...(!profile.billing ? ["billing"] : []),
    ...(!profile.defaultAddressId ? ["address"] : [])
  ];
  return {
    name: user.name, email: user.email, phone: profile.phone, altPhone: profile.altPhone, billing: profile.billing,
    addresses, defaultAddressId: profile.defaultAddressId, revision: profile.revision,
    maxAddresses: MAX_CUSTOMER_ADDRESSES, missing, complete: missing.length === 0
  };
}
export type CustomerProfileView = ReturnType<typeof view>;

/** Lee, valida la revisión, aplica `change` y guarda; todo en una unidad de trabajo. */
async function mutate<T>(actor: AuthUser | null | undefined, revision: unknown, change: (profile: StoredProfile, user: AuthUser) => Promise<T> | T): Promise<{ profile: CustomerProfileView; result: T }> {
  const user = authService.requireCustomer(actor);
  const expected = revisionSchema.parse(revision);
  const work = async () => {
    const current = await load(user.id) ?? empty(user.id);
    if (current.revision !== expected) throw conflict();
    const next = structuredClone(current);
    const result = await change(next, user);
    next.revision = expected + 1;
    next.updatedAt = new Date().toISOString();
    await persist(user.id, expected, next);
    const renamed = (result as { renamed?: string } | undefined)?.renamed;
    if (renamed) await authService.renameCustomer(user.id, renamed);
    return { profile: view(renamed ? { ...user, name: renamed } : user, next), result };
  };
  return operationContext.getStore() ? work() : unitOfWork(work, { actorId: user.id, reason: "Perfil de cliente" });
}

const findAddress = (profile: StoredProfile, raw: unknown) => {
  const parsed = idSchema.safeParse(raw);
  const address = parsed.success ? profile.addresses.find(a => a.id === parsed.data) : undefined;
  if (!address) throw addressNotFound();
  return address;
};

export const customerProfileService = {
  async get(actor: AuthUser | null | undefined) {
    const user = authService.requireCustomer(actor);
    return view(user, await load(user.id) ?? empty(user.id));
  },

  /** Perfil interno para el checkout (CU07/CU08); incluye la huella de cada dirección. */
  async stored(userId: string) {
    return load(userId);
  },

  async updateContact(actor: AuthUser | null | undefined, raw: unknown, revision: unknown) {
    const input = contactInputSchema.parse(raw);
    return (await mutate(actor, revision, (profile, user) => {
      profile.phone = input.phone;
      profile.altPhone = input.altPhone;
      return { renamed: input.name !== user.name ? input.name : undefined };
    })).profile;
  },

  /** `null` borra los datos de factura propios: se vuelve a usar el nombre y documento del titular al comprar. */
  async updateBilling(actor: AuthUser | null | undefined, raw: unknown, revision: unknown) {
    const input = raw === null ? null : billingInputSchema.parse(raw);
    return (await mutate(actor, revision, profile => { profile.billing = input; })).profile;
  },

  /**
   * Alta de dirección. Si ya existe una igual en la cuenta se devuelve esa (`duplicate`), sin crear otra ni
   * exigir revisión: así un doble clic o un reintento no duplican. `makeDefault` la deja como predeterminada.
   */
  async addAddress(actor: AuthUser | null | undefined, raw: unknown, revision: unknown, makeDefault = false) {
    const input = addressInputSchema.parse(raw);
    const fingerprint = addressFingerprint(input);
    const user = authService.requireCustomer(actor);
    const existing = (await load(user.id))?.addresses.find(a => a.fingerprint === fingerprint);
    if (existing && !makeDefault) return { profile: await this.get(user), addressId: existing.id, duplicate: true, madeDefault: false };
    const { profile, result } = await mutate(user, revision, current => {
      const repeated = current.addresses.find(a => a.fingerprint === fingerprint);
      if (repeated) { current.defaultAddressId = repeated.id; return { addressId: repeated.id, duplicate: true, madeDefault: true }; }
      if (current.addresses.length >= MAX_CUSTOMER_ADDRESSES) throw fieldError("addresses", `Puedes guardar hasta ${MAX_CUSTOMER_ADDRESSES} direcciones. Elimina una para agregar otra.`);
      const now = new Date().toISOString();
      const address: Address = { id: randomUUID(), ...input, fingerprint, createdAt: now, updatedAt: now };
      current.addresses.push(address);
      const first = !current.defaultAddressId;
      if (first || makeDefault) current.defaultAddressId = address.id;
      return { addressId: address.id, duplicate: false, madeDefault: first || makeDefault };
    });
    return { profile, ...result };
  },

  async updateAddress(actor: AuthUser | null | undefined, addressId: unknown, raw: unknown, revision: unknown) {
    const input = addressInputSchema.parse(raw);
    const fingerprint = addressFingerprint(input);
    return (await mutate(actor, revision, profile => {
      const address = findAddress(profile, addressId);
      if (profile.addresses.some(a => a.id !== address.id && a.fingerprint === fingerprint)) throw fieldError("address", "Ya tienes guardada otra dirección igual.");
      Object.assign(address, input, { fingerprint, updatedAt: new Date().toISOString() });
    })).profile;
  },

  /**
   * Borra una dirección. Si era la predeterminada, `nextDefaultId` es obligatorio: el id de otra dirección
   * o `null` para quedarse sin predeterminada. Nunca se elige otra en silencio. Los pedidos guardan su copia.
   */
  async removeAddress(actor: AuthUser | null | undefined, addressId: unknown, revision: unknown, nextDefaultId?: unknown) {
    return (await mutate(actor, revision, profile => {
      const address = findAddress(profile, addressId);
      profile.addresses = profile.addresses.filter(a => a.id !== address.id);
      if (profile.defaultAddressId !== address.id) return;
      if (nextDefaultId === undefined) {
        if (!profile.addresses.length) { profile.defaultAddressId = null; return; }
        throw fieldError("nextDefaultId", "Esta es tu dirección predeterminada. Elige cuál usar en su lugar o confirma que no quieres ninguna.");
      }
      profile.defaultAddressId = nextDefaultId === null ? null : findAddress(profile, nextDefaultId).id;
    })).profile;
  },

  async setDefaultAddress(actor: AuthUser | null | undefined, addressId: unknown, revision: unknown) {
    return (await mutate(actor, revision, profile => { profile.defaultAddressId = findAddress(profile, addressId).id; })).profile;
  }
};
