import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutAttempt, findCheckoutAttempt } from "./checkoutAttempt";

afterEach(() => vi.unstubAllGlobals());

describe("checkoutAttempt", () => {
  it("consultar una confirmación pendiente nunca crea un intento nuevo", async () => {
    const input = {customer: "lookup-only", quantity: 1};
    expect(await findCheckoutAttempt(input)).toBeNull();
    const attempt = await checkoutAttempt(input);
    expect((await findCheckoutAttempt(input))?.key).toBe(attempt.key);
    expect(await findCheckoutAttempt({...input, quantity: 2})).toBeNull();
    attempt.complete();
    expect(await findCheckoutAttempt(input)).toBeNull();
  });
  it("conserva la clave en reintentos y llamadas simultáneas hasta confirmar éxito", async () => {
    const input = { customer: "retry", items: [{ sku: "A", quantity: 1 }] };
    const [first, duplicate] = await Promise.all([checkoutAttempt(input), checkoutAttempt(input)]);
    expect(duplicate.key).toBe(first.key);
    expect((await checkoutAttempt(structuredClone(input))).key).toBe(first.key);
    first.complete();
    const nextPurchase = await checkoutAttempt(input);
    expect(nextPurchase.key).not.toBe(first.key);
    duplicate.complete();
    expect((await checkoutAttempt(input)).key).toBe(nextPurchase.key);
    nextPurchase.complete();
  });

  it("separa carritos distintos y conserva reintentos sin almacenamiento disponible", async () => {
    vi.stubGlobal("sessionStorage", { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } });
    const first = await checkoutAttempt({ customer: "private", quantity: 1 });
    const changed = await checkoutAttempt({ customer: "private", quantity: 2 });
    expect(changed.key).not.toBe(first.key);
    expect((await checkoutAttempt({ customer: "private", quantity: 1 })).key).toBe(first.key);
    first.complete(); changed.complete();
  });

  it("recupera la clave guardada y no guarda datos personales", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    });
    const input = { email: "cliente@example.test", quantity: 3 };
    const attempt = await checkoutAttempt(input);
    expect([...values.entries()]).toEqual([[expect.stringMatching(/^rawenergy-checkout:[a-f0-9]{64}$/), attempt.key]]);
    attempt.complete();
    expect(values.size).toBe(0);
  });

  it("conserva el importe aceptado al reintentar aunque cambie la cotización", async () => {
    const input = { customer: "quote-guard", quantity: 1 };
    const first = await checkoutAttempt(input, 29);
    expect((await checkoutAttempt(input, 31)).expectedTotal).toBe(29);
    expect((await findCheckoutAttempt(input))?.expectedTotal).toBe(29);
    first.complete();
    const next = await checkoutAttempt(input, 31);
    expect(next.expectedTotal).toBe(31); next.complete();
  });

  it("informa cuando el navegador no permite generar una clave segura", async () => {
    vi.stubGlobal("crypto", undefined);
    await expect(checkoutAttempt({ customer: "insecure" })).rejects.toThrow("HTTPS");
  });
});
