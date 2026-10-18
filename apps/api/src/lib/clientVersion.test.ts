// VER-01: una app por debajo de la versión mínima consulta pero no escribe.
import { describe, expect, it } from "vitest";
import { isMutation, isOutdated, minimumVersions, parseClient } from "./clientVersion.js";

describe("Versión mínima de cliente (VER-01)", () => {
  const minimums = minimumVersions('{"panel-windows":"1.2.0","panel-android":"1.0.0","malo":"x"}');
  it("lee la cabecera y la configuración, ignorando valores inválidos", () => {
    expect(parseClient("panel-windows/1.1.9")).toEqual({ platform: "panel-windows", version: "1.1.9" });
    expect(parseClient("<script>/1.0")).toBeNull();
    expect(minimums).toEqual({ "panel-windows": "1.2.0", "panel-android": "1.0.0" });
    expect(minimumVersions("{no-json")).toEqual({});
  });
  it("marca desactualizada solo la plataforma con mínima y versión inferior", () => {
    expect(isOutdated(parseClient("panel-windows/1.1.9"), minimums)).toBe(true);
    expect(isOutdated(parseClient("panel-windows/1.10.0"), minimums)).toBe(false);
    expect(isOutdated(parseClient("panel-web/0.0.0"), minimums)).toBe(false);
    expect(isOutdated(null, minimums)).toBe(false);
  });
  it("distingue escrituras de consultas, aunque el texto mencione «mutation»", () => {
    expect(isMutation({ query: "mutation { logout }" })).toBe(true);
    expect(isMutation({ query: "query Q { products(search: \"mutation\") { id } }" })).toBe(false);
    expect(isMutation({ query: "{ me { id } }" })).toBe(false);
    expect(isMutation(null)).toBe(false);
  });
});
