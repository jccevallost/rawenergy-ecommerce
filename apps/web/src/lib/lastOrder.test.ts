import { afterEach, describe, expect, it, vi } from "vitest";
import { readLastOrder, recentSameOrder, rememberLastOrder, REPEAT_WINDOW_MS } from "./lastOrder";

const storage = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } }; };
const line = (productId: string, quantity = 1) => ({ productId, variantSku: `${productId}-SKU`, quantity });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("aviso de pedido repetido (P02)", () => {
  it("detecta los mismos productos y cantidades en cualquier orden durante 30 minutos", () => {
    vi.stubGlobal("localStorage", storage()); vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    rememberLastOrder("RE-260927-AB12C", [line("a", 2), line("b")]);
    expect(readLastOrder()).toBe("RE-260927-AB12C");
    expect(recentSameOrder([line("b"), line("a", 2)])).toBe("RE-260927-AB12C");
    expect(recentSameOrder([line("a", 1), line("b")])).toBeNull();
    expect(recentSameOrder([line("a", 2)])).toBeNull();
    vi.setSystemTime(1_000_000 + REPEAT_WINDOW_MS + 1);
    expect(recentSameOrder([line("a", 2), line("b")])).toBeNull();
  });
  it("sin almacenamiento o con datos dañados no avisa ni falla", () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("bloqueado"); }, setItem() { throw new Error("bloqueado"); } });
    rememberLastOrder("RE-260927-AB12C", [line("a")]);
    expect(recentSameOrder([line("a")])).toBeNull();
    const broken = storage(); broken.setItem("rawenergy-last-order-v1", "{roto"); vi.stubGlobal("localStorage", broken);
    expect(readLastOrder()).toBeNull(); expect(recentSameOrder([line("a")])).toBeNull();
  });
});
