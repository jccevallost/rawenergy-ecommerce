import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetGuestOrders, hasSession, linkGuestOrders, readGuestOrders, rememberGuestOrder } from "./guestOrders";

const storage = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } }; };
afterEach(() => { vi.unstubAllGlobals(); });

describe("pedidos hechos sin sesión en este navegador (C44)", () => {
  it("guarda solo números válidos, sin repetir y con el más reciente al final", () => {
    vi.stubGlobal("localStorage", storage());
    rememberGuestOrder("RE-260929-AB12C"); rememberGuestOrder("no-es-un-pedido"); rememberGuestOrder("RE-260929-ZZ99X"); rememberGuestOrder("RE-260929-AB12C");
    expect(readGuestOrders()).toEqual(["RE-260929-ZZ99X", "RE-260929-AB12C"]);
  });

  it("conserva como máximo 20 y olvida los que ya se enlazaron", () => {
    vi.stubGlobal("localStorage", storage());
    for (let i = 0; i < 25; i++) rememberGuestOrder(`RE-260929-A${String(i).padStart(4, "0")}`);
    expect(readGuestOrders()).toHaveLength(20);
    expect(readGuestOrders()[0]).toBe("RE-260929-A0005");
    forgetGuestOrders(["RE-260929-A0005", "RE-260929-A0024"]);
    expect(readGuestOrders()).toHaveLength(18);
  });

  it("ignora datos dañados y no falla con el almacenamiento bloqueado", () => {
    vi.stubGlobal("localStorage", { ...storage(), getItem: () => "{roto" });
    expect(readGuestOrders()).toEqual([]);
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); }, removeItem: () => { throw new Error("bloqueado"); } });
    expect(() => rememberGuestOrder("RE-260929-AB12C")).not.toThrow();
    expect(hasSession()).toBe(false);
  });

  it("al enlazar olvida los enlazados y conserva los que pueden ser de otra cuenta", async () => {
    vi.stubGlobal("localStorage", storage());
    rememberGuestOrder("RE-260929-AB12C"); rememberGuestOrder("RE-260929-ZZ99X");
    const mutate = vi.fn().mockResolvedValue({ data: { linkGuestOrders: { linked: 1, orderNumbers: ["RE-260929-AB12C"] } } });
    const linked = await linkGuestOrders({ mutate } as never);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ variables: { orderNumbers: ["RE-260929-AB12C", "RE-260929-ZZ99X"] } }));
    expect(linked).toEqual(["RE-260929-AB12C"]);
    expect(readGuestOrders()).toEqual(["RE-260929-ZZ99X"]);
  });

  it("sin pedidos recordados no llama a la API", async () => {
    vi.stubGlobal("localStorage", storage());
    const mutate = vi.fn();
    expect(await linkGuestOrders({ mutate } as never)).toEqual([]);
    expect(mutate).not.toHaveBeenCalled();
  });
});
