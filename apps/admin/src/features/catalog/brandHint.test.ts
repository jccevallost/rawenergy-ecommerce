import { describe, expect, it } from "vitest";
import { similarBrand } from "./brandHint";

const brands = ["Dragon Pharma", "Optimum Nutrition", "Insane Labz", "MuscleTech"];

describe("Marca parecida (C66, V20)", () => {
  it("avisa de errores de tipeo y variantes de una marca existente", () => {
    expect(similarBrand("Dargon Pharma", brands)).toBe("Dragon Pharma");
    expect(similarBrand("Dragon Pharma Labs", brands)).toBe("Dragon Pharma");
    expect(similarBrand("muscle tech", brands)).toBe("MuscleTech");
  });
  it("no avisa si coincide o si es otra marca", () => {
    expect(similarBrand("dragon pharma", brands)).toBeNull();
    expect(similarBrand("Dymatize", brands)).toBeNull();
    expect(similarBrand("Ev", brands)).toBeNull();
  });
});
