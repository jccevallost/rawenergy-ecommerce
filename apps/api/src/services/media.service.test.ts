import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { mediaService } from "./media.service.js";
import { productService } from "./product.service.js";
import { demoProducts } from "../data/demoProducts.js";
describe("Imágenes normalizadas en el servidor", () => {
  it("rechaza texto o SVG disfrazado de PNG", async () => {
    await expect(mediaService.save(Buffer.from("not an image"), "image/png")).rejects.toThrow();
    await expect(mediaService.save(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" /></svg>'), "image/png")).rejects.toThrow(/contenido/);
  });
  it("reduce, convierte a WebP, conserva proporción y deduplica", async () => {
    const input = await sharp({ create: { width: 2800, height: 1400, channels: 4, background: { r: 150, g: 30, b: 40, alpha: .5 } } }).png().toBuffer();
    const saved = await mediaService.save(input, "image/jpeg");
    expect(saved).toMatchObject({ contentType: "image/webp", width: 1400, height: 700 });
    expect((await mediaService.save(input, "image/png")).id).toBe(saved.id);
    const file = await mediaService.get(saved.id); expect((await sharp(file!.data).metadata()).format).toBe("webp");
    const thumbnail=await mediaService.get(saved.id,true);expect((await sharp(thumbnail!.data).metadata()).width).toBe(360);expect(thumbnail!.data.length).toBeLessThan(file!.data.length);
    await mediaService.rename(saved.id,"Creatina principal");expect((await mediaService.list(0,30,"Creatina")).total).toBe(1);expect((await mediaService.list(0,30,"sin coincidencias")).total).toBe(0);
    const product = structuredClone(demoProducts[1]!); product.slug = "media-reference-test"; product.variants[0]!.images = [{ url: `http://localhost:4000/media/${saved.id}`, alt: "Foto" }];
    await productService.upsert(undefined, product);
    await expect(mediaService.remove(saved.id)).rejects.toThrow(/vinculada/);
    expect((await mediaService.list()).rows[0]).not.toHaveProperty("data");
    expect((await mediaService.list()).rows[0]).not.toHaveProperty("thumbnail");
  });
});
