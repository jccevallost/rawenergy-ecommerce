import { describe, expect, it } from "vitest";
import { parse } from "./routes";

const at = (path: string) => parse(new URL(path, "https://tienda.example.test"));

// CU05: rutas privadas del cliente.
describe("rutas de cuenta y pedidos", () => {
  it("reconoce las secciones de la cuenta, con o sin barra final", () => {
    expect(at("/cuenta")).toEqual({ name: "account", section: "perfil" });
    expect(at("/cuenta/")).toEqual({ name: "account", section: "perfil" });
    expect(at("/cuenta/direcciones")).toEqual({ name: "account", section: "direcciones" });
    expect(at("/cuenta/seguridad")).toEqual({ name: "account", section: "seguridad" });
  });

  it("reconoce Mis pedidos y el detalle por número, normalizado en mayúsculas", () => {
    expect(at("/mis-pedidos")).toEqual({ name: "orders" });
    expect(at("/mis-pedidos/re-261016-ab12c")).toEqual({ name: "orderDetail", number: "RE-261016-AB12C" });
  });

  it("no acepta secciones o números inventados", () => {
    for (const path of ["/cuenta/admin", "/cuenta/direcciones/1", "/mis-pedidos/123", "/mis-pedidos/RE-261016-AB12C/x", "/mis-pedidos/..%2Fcuenta"]) expect(at(path)).toEqual({ name: "notFound" });
  });
});
