import { usesMongo } from "../lib/persistence.js";
import { registerMemoryStore } from "../lib/unitOfWork.js";
import { BlockedIdentityModel } from "../models/BlockedIdentity.js";

// CU11, decisión del propietario del 16/10/2026: tres cancelaciones seguidas bloquean al cliente y el bloqueo
// impide toda acción, también como invitado con el mismo documento, celular o correo, hasta el desbloqueo
// manual del operador. Este módulo solo guarda y consulta esas identidades; no importa servicios.
export const CANCELLATION_BLOCK_LIMIT = 3;
export const blockedMessage = "Tu cuenta quedó bloqueada por seguridad. Escríbenos por WhatsApp para revisarla.";

let memory: Array<{ key: string; userId: string }> = [];
registerMemoryStore(() => memory, value => { memory = value; });

export const blockedIdentities = {
  async any(keys: string[]) {
    const wanted = [...new Set(keys.filter(Boolean))];
    if (!wanted.length) return false;
    if (usesMongo()) return Boolean(await BlockedIdentityModel.exists({ _id: { $in: wanted } }));
    return memory.some(entry => wanted.includes(entry.key));
  },
  async add(userId: string, keys: string[]) {
    const wanted = [...new Set(keys.filter(Boolean))];
    if (usesMongo()) {
      // upsert: una clave ya registrada (p. ej. por otra cuenta) no hace fallar el bloqueo.
      for (const key of wanted) await BlockedIdentityModel.updateOne({ _id: key }, { $setOnInsert: { userId } }, { upsert: true });
      return;
    }
    for (const key of wanted) if (!memory.some(entry => entry.key === key)) memory.push({ key, userId });
  },
  async removeFor(userId: string) {
    if (usesMongo()) { await BlockedIdentityModel.deleteMany({ userId }); return; }
    memory = memory.filter(entry => entry.userId !== userId);
  }
};
