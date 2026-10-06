import { describe, expect, it } from "vitest";
import { envSchema } from "./env.js";

describe("WhatsApp de la tienda (C74)", () => {
  it("sin la variable usa el número del propietario; vacía apaga los botones; se recorta", () => {
    expect(envSchema.parse({}).STORE_WHATSAPP).toBe("593983368127");
    expect(envSchema.parse({ STORE_WHATSAPP: "" }).STORE_WHATSAPP).toBeUndefined();
    expect(envSchema.parse({ STORE_WHATSAPP: "  " }).STORE_WHATSAPP).toBeUndefined();
    expect(envSchema.parse({ STORE_WHATSAPP: " 593999999999 " }).STORE_WHATSAPP).toBe("593999999999");
  });
});
