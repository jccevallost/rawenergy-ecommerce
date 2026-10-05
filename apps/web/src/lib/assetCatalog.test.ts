import { describe, expect, it, vi } from "vitest";

vi.mock("virtual:asset-manifest", () => ({ assetManifest: ["/assets/brands/dymatize.webp", "/assets/brands/dymatize.png", "/assets/store/logo.webp", "/assets/store/logo.png"] }));

describe("Imágenes (C64)", () => {
  it("prefiere WebP o SVG antes que PNG en los logos", async () => {
    const { brandLogoFor, siteLogoCandidates } = await import("./assetCatalog");
    expect(brandLogoFor("Dymatize")[0]).toBe("/assets/brands/dymatize.webp");
    expect(siteLogoCandidates()).toEqual(["/assets/store/logo.webp", "/assets/store/logo.png"]);
  });
  it("arma srcset solo para fotos de la biblioteca", async () => {
    const { mediaSrcSet } = await import("./assetCatalog");
    const url = `https://api.ejemplo.ec/media/${"a".repeat(32)}`;
    expect(mediaSrcSet(`${url}?size=thumb`)).toBe(`${url}?size=thumb 360w, ${url}?size=medium 720w, ${url} 1400w`);
    expect(mediaSrcSet("https://cdn.ejemplo.ec/foto.webp")).toBeUndefined();
  });
});
