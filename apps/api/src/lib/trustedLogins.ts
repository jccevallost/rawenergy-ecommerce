// Conexiones desde las que una cuenta ya entró bien (C60, S03). Los fallos repartidos
// entre muchas IP bloquean la cuenta solo para conexiones nuevas: quien vuelve a
// entrar desde una conexión conocida no queda fuera por intentos ajenos.
//
// Vive en la memoria de la instancia: un reinicio la vacía y, hasta el siguiente acceso
// correcto, la cuenta vuelve a la regla general.
const TTL_MS = 30 * 24 * 3600_000;
const MAX_PER_ACCOUNT = 10;
const MAX_ACCOUNTS = 5000;

export function createTrustedLogins(now: () => number = Date.now) {
  const byAccount = new Map<string, Map<string, number>>();
  const fresh = (account: string) => {
    const known = byAccount.get(account);
    if (!known) return undefined;
    for (const [ip, until] of known) if (until <= now()) known.delete(ip);
    if (!known.size) { byAccount.delete(account); return undefined; }
    return known;
  };
  return {
    has: (account: string, ip: string) => Boolean(fresh(account)?.has(ip)),
    remember(account: string, ip: string) {
      const known = fresh(account) ?? new Map<string, number>();
      known.delete(ip);
      known.set(ip, now() + TTL_MS);
      while (known.size > MAX_PER_ACCOUNT) known.delete(known.keys().next().value!);
      byAccount.delete(account);
      byAccount.set(account, known);
      while (byAccount.size > MAX_ACCOUNTS) byAccount.delete(byAccount.keys().next().value!);
    },
    size: () => byAccount.size
  };
}

export const trustedLogins = createTrustedLogins();
