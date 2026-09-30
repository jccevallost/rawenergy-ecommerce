// The same checkout keeps its key after a lost response, including a page reload.
const fallback = new Map<string, string>();
const acceptedTotals = new Map<string, number>();
async function resolveAttempt(input: unknown, create: boolean, expectedTotal?: number) {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.randomUUID) {
    throw new Error("No se pudo preparar el pedido de forma segura. Abre la tienda mediante HTTPS y vuelve a intentarlo.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(input)));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const storageKey = `rawenergy-checkout:${fingerprint}`;
  let key = fallback.get(storageKey);
  try { key ??= sessionStorage.getItem(storageKey) ?? undefined; } catch { /* private browsing */ }
  if (!key && !create) return null;
  key ??= crypto.randomUUID();
  fallback.set(storageKey, key);
  try { sessionStorage.setItem(storageKey, key); } catch { /* keep the in-memory retry key */ }
  const totalKey = `${storageKey}:total`;
  let acceptedTotal = acceptedTotals.get(key);
  try { const saved = sessionStorage.getItem(totalKey); if (acceptedTotal === undefined && saved !== null && Number.isFinite(Number(saved))) acceptedTotal = Number(saved); } catch { /* no storage */ }
  if (acceptedTotal === undefined && expectedTotal !== undefined && Number.isFinite(expectedTotal)) acceptedTotal = expectedTotal;
  if (acceptedTotal !== undefined) {
    acceptedTotals.set(key, acceptedTotal);
    try { sessionStorage.setItem(totalKey, String(acceptedTotal)); } catch { /* in-memory fallback */ }
  }
  return { key, expectedTotal: acceptedTotal, complete() {
    // A late callback from an already completed request must not erase a newer attempt.
    if (fallback.get(storageKey) === key) fallback.delete(storageKey);
    acceptedTotals.delete(key);
    try { if (sessionStorage.getItem(storageKey) === key) { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(totalKey); } } catch { /* no storage */ }
  } };
}

export async function checkoutAttempt(input: unknown, expectedTotal?: number) {
  return (await resolveAttempt(input, true, expectedTotal))!;
}

/** Consult an existing retry without creating a new purchase attempt. */
export async function findCheckoutAttempt(input: unknown) {
  return resolveAttempt(input, false);
}
