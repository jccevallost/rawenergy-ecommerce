import { afterEach, describe, expect, it } from "vitest";
import { env } from "../config/env.js";
import { publicMediaUrl } from "./mediaUrl.js";

const id = "6cf12b1471231c580dcec9c94692db2d";
const original = env.PUBLIC_API_URL;
afterEach(() => { env.PUBLIC_API_URL = original; });

describe("dirección pública de las fotos", () => {
  it("rehace con PUBLIC_API_URL las fotos guardadas desde una prueba local", () => {
    env.PUBLIC_API_URL = "https://rawenergy-api.onrender.com";
    expect(publicMediaUrl(`http://localhost:4000/media/${id}`)).toBe(`https://rawenergy-api.onrender.com/media/${id}`);
    expect(publicMediaUrl(`http://localhost:4000/media/${id}?size=thumb`)).toBe(`https://rawenergy-api.onrender.com/media/${id}?size=thumb`);
    expect(publicMediaUrl(`/media/${id}`)).toBe(`https://rawenergy-api.onrender.com/media/${id}`);
    expect(publicMediaUrl(`https://api-anterior.example/media/${id}`)).toBe(`https://rawenergy-api.onrender.com/media/${id}`);
  });

  it("no toca fotos de otros sitios, rutas de la tienda ni valores vacíos", () => {
    env.PUBLIC_API_URL = "https://rawenergy-api.onrender.com";
    expect(publicMediaUrl("https://cdn.example.com/media/foto.jpg")).toBe("https://cdn.example.com/media/foto.jpg");
    expect(publicMediaUrl("/assets/products/gold-standard.webp")).toBe("/assets/products/gold-standard.webp");
    expect(publicMediaUrl(`https://cdn.example.com/media/${id}/otra`)).toBe(`https://cdn.example.com/media/${id}/otra`);
    expect(publicMediaUrl(null)).toBeNull();
    expect(publicMediaUrl("")).toBe("");
  });

  it("sin PUBLIC_API_URL (desarrollo) deja la dirección como está", () => {
    env.PUBLIC_API_URL = "";
    expect(publicMediaUrl(`http://localhost:4000/media/${id}`)).toBe(`http://localhost:4000/media/${id}`);
  });
});
