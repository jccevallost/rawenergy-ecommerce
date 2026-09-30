// Pedidos hechos sin sesión en este navegador (C44). Solo se guarda el número:
// al entrar o crear la cuenta se enlazan los que tengan el correo de la cuenta.
import type { ApolloClient } from "@apollo/client";
import { LINK_GUEST_ORDERS } from "@vital-forge/shared-logic";

const KEY = "rawenergy-guest-orders-v1";
const MAX = 20;
export const ORDER_NUMBER = /^RE-\d{6}-[A-Z0-9]{3,10}$/;

export function readGuestOrders(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((n): n is string => typeof n === "string" && ORDER_NUMBER.test(n)).slice(-MAX) : [];
  } catch { return []; }
}

function write(numbers: string[]) {
  try {
    if (numbers.length) localStorage.setItem(KEY, JSON.stringify(numbers.slice(-MAX)));
    else localStorage.removeItem(KEY);
  } catch { /* almacenamiento bloqueado */ }
}

export function hasSession() {
  try { return Boolean(localStorage.getItem("rawenergy-token")); } catch { return false; }
}

export function rememberGuestOrder(orderNumber: string) {
  if (!ORDER_NUMBER.test(orderNumber)) return;
  write([...readGuestOrders().filter(n => n !== orderNumber), orderNumber]);
}

export function forgetGuestOrders(numbers: string[]) {
  const drop = new Set(numbers);
  write(readGuestOrders().filter(n => !drop.has(n)));
}

type Linked = { linkGuestOrders: { linked: number; orderNumbers: string[] } };

/** Enlaza los números indicados (o los recordados en este navegador). Devuelve los enlazados. */
export async function linkGuestOrders(client: ApolloClient<object>, numbers = readGuestOrders()): Promise<string[]> {
  if (!numbers.length) return [];
  const { data } = await client.mutate<Linked>({ mutation: LINK_GUEST_ORDERS, variables: { orderNumbers: numbers } });
  const linked = data?.linkGuestOrders.orderNumbers ?? [];
  // Los enlazados ya no hacen falta aquí; los demás pueden ser de otra cuenta y se conservan.
  forgetGuestOrders(linked);
  return linked;
}
