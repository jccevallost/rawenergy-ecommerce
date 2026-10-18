// CU04: enlaces de los correos de la cuenta. El token llega en el fragmento (#), que no viaja al servidor ni en
// el Referer; App lo retira de la dirección antes de usarlo para que no quede en el historial ni se comparta.
export type AccountLinkKind = "verificar" | "restablecer" | "cambio-correo";
export type AccountLink = { kind: AccountLinkKind; token: string };

export function readAccountLink(hash: string): AccountLink | null {
  const match = /^#(verificar|restablecer|cambio-correo)=([A-Za-z0-9_%-]{30,300})$/.exec(hash);
  if (!match) return null;
  try { return { kind: match[1] as AccountLinkKind, token: decodeURIComponent(match[2]!) }; } catch { return null; }
}
