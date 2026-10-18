// M05: comprobaciones de formato de comprobantes electrónicos de Ecuador. Validan la estructura de
// lo impreso; no consultan al SRI ni acreditan que el comprobante esté autorizado.

/** Dígito verificador módulo 11 de la clave de acceso (pesos 2 a 7 desde la derecha). */
export function accessKeyCheckDigit(first48: string): number {
  const weights = [2, 3, 4, 5, 6, 7];
  const total = [...first48].reverse().reduce((sum, digit, i) => sum + Number(digit) * weights[i % 6]!, 0);
  const digit = 11 - (total % 11);
  return digit === 11 ? 0 : digit === 10 ? 1 : digit;
}

export type AccessKeyParts = { issuedOn: string; documentType: string; taxId: string; environment: string; series: string; sequential: string };
/** Devuelve las partes de una clave de 49 dígitos, o un mensaje que explica qué corregir. */
export function parseAccessKey(key: string): AccessKeyParts | string {
  if (!/^\d{49}$/.test(key)) return "La clave de acceso debe tener 49 dígitos.";
  if (accessKeyCheckDigit(key.slice(0, 48)) !== Number(key[48])) return "El dígito verificador de la clave de acceso no coincide. Revisa que esté copiada completa.";
  const day = key.slice(0, 2), month = key.slice(2, 4), year = key.slice(4, 8);
  return { issuedOn: `${year}-${month}-${day}`, documentType: key.slice(8, 10), taxId: key.slice(10, 23), environment: key.slice(23, 24), series: key.slice(24, 30), sequential: key.slice(30, 39) };
}
