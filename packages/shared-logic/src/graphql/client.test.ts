import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRateLimit } from "./client";

const limited = { errors: [{ message: "Demasiadas solicitudes seguidas. Espera un minuto y vuelve a intentarlo.", extensions: { code: "RATE_LIMITED", retryAfter: 60 } }] };
afterEach(() => vi.unstubAllGlobals());

describe("fetchWithRateLimit", () => {
  it("entrega el 429 del límite como errores GraphQL para mostrar el mensaje y no reintentar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(limited), { status: 429, headers: { "content-type": "application/json" } })));
    const response = await fetchWithRateLimit("http://api/graphql", { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(limited);
  });

  it("deja igual un 429 que no es GraphQL y cualquier otra respuesta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Too Many Requests", { status: 429 })));
    expect((await fetchWithRateLimit("http://api/graphql")).status).toBe(429);
    const ok = new Response("{\"data\":{}}", { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async () => ok));
    expect(await fetchWithRateLimit("http://api/graphql")).toBe(ok);
  });
});
