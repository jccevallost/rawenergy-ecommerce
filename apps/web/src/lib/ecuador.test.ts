import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ECUADOR, cantonLabel, emailProblem, emailSuggestion, findCanton, idNumberProblem, identificationProblem, inferIdType, isExpressArea, mobileProblem, normalizeIdentification, normalizeMobile } from "./ecuador";

describe("datos de Ecuador compartidos con el servidor", () => {
  it("la copia del servidor es idéntica", () => {
    const here = readFileSync(new URL("./ecuador.ts", import.meta.url), "utf8");
    const api = readFileSync(new URL("../../../api/src/data/ecuador.ts", import.meta.url), "utf8");
    expect(api).toBe(here);
  });
  it("24 provincias y 223 cantones, sin repetidos dentro de una provincia", () => {
    expect(ECUADOR).toHaveLength(24);
    expect(ECUADOR.reduce((sum, entry) => sum + entry.cantons.length, 0)).toBe(223);
    for (const entry of ECUADOR) expect(new Set(entry.cantons.map(([name]) => name)).size).toBe(entry.cantons.length);
  });
  it("encuentra el cantón por nombre o por cabecera, sin importar tildes", () => {
    expect(findCanton("Pichincha", "sangolqui")?.[0]).toBe("Rumiñahui");
    expect(findCanton("pichincha", "QUITO")?.[0]).toBe("Quito");
    expect(findCanton("Guayas", "Quito")).toBeNull();
    expect(cantonLabel(findCanton("Morona Santiago", "Macas")!)).toBe("Morona (Macas)");
  });
  it("express solo en Quito y Rumiñahui", () => {
    expect(isExpressArea("Pichincha", "Quito")).toBe(true);
    expect(isExpressArea("Pichincha", "Sangolquí")).toBe(true);
    expect(isExpressArea("Pichincha", "Cayambe")).toBe(false);
    expect(isExpressArea("Guayas", "Guayaquil")).toBe(false);
  });
});

describe("validaciones de datos de entrega", () => {
  it("celular: 10 dígitos que empiezan en 09; acepta espacios y +593", () => {
    for (const ok of ["0991234567", "099 123 4567", "+593 99 123 4567", "593991234567"]) expect(mobileProblem(ok)).toBeNull();
    expect(normalizeMobile("+593 99 123 4567")).toBe("0991234567");
    for (const bad of ["991234567", "02 234 5678", "09912345678", "1991234567", "abc"]) expect(mobileProblem(bad)).not.toBeNull();
  });
  it("cédula y RUC con dígito verificador", () => {
    expect(idNumberProblem("")).toBeNull();
    expect(idNumberProblem("1700000001")).toBeNull();
    expect(idNumberProblem("1700000002")).toMatch(/cédula/);
    expect(idNumberProblem("2500000000")).toMatch(/cédula/);
    expect(idNumberProblem("1700000001001")).toBeNull();
    expect(idNumberProblem("1700000002001")).toMatch(/RUC/);
    expect(idNumberProblem("1790000000001")).toBeNull();
    expect(idNumberProblem("1790000000000")).toMatch(/RUC/);
    expect(idNumberProblem("12345")).toMatch(/10 dígitos/);
  });
  it("identificación por tipo: cédula y RUC verificados, pasaporte sin verificar", () => {
    expect(identificationProblem("CEDULA", "")).toMatch(/factura/);
    expect(identificationProblem("CEDULA", "1700000001")).toBeNull();
    expect(identificationProblem("CEDULA", "1700000001001")).toMatch(/10 dígitos/);
    expect(identificationProblem("RUC", "1700000001")).toMatch(/13 dígitos/);
    expect(identificationProblem("RUC", "1700000001001")).toBeNull();
    expect(identificationProblem("PASAPORTE", "ab 1234-56")).toBeNull();
    expect(normalizeIdentification("PASAPORTE", "ab 1234-56")).toBe("AB123456");
    expect(identificationProblem("PASAPORTE", "A1")).toMatch(/5 a 20/);
    expect(identificationProblem("PASAPORTE", "")).toMatch(/pasaporte/);
    expect([inferIdType("1700000001"), inferIdType("1790000000001"), inferIdType("AB123456")]).toEqual(["CEDULA", "RUC", null]);
  });
  it("correo con usuario, @ y dominio con extensión", () => {
    for (const ok of ["nombre@gmail.com", "nombre.apellido+tienda@empresa.com.ec", "a@b.co"]) expect(emailProblem(ok)).toBeNull();
    for (const bad of ["nombre", "nombre@", "@gmail.com", "nombre@gmail", "nombre@gmail.c", "nom bre@gmail.com", "nombre..x@gmail.com", ".nombre@gmail.com", "nombre@-gmail.com"]) expect(emailProblem(bad)).not.toBeNull();
  });
  it("sugiere el dominio común ante un error de tipeo", () => {
    expect(emailSuggestion("ana@gmial.com")).toBe("ana@gmail.com");
    expect(emailSuggestion("ana@hotmial.com")).toBe("ana@hotmail.com");
    expect(emailSuggestion("ana@gmail.con")).toBe("ana@gmail.com");
    expect(emailSuggestion("ana@gmail.com")).toBeNull();
    expect(emailSuggestion("ana@miempresa.ec")).toBeNull();
  });
});
