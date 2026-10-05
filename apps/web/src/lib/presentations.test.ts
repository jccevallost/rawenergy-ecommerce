import { describe, expect, it } from "vitest";
import { LOW_STOCK, presentationLabel, presentationSummary, sizeLabel } from "./presentations";

const variant = (flavor: string, value: number, unit: string, stock = 10) => ({ flavor, sizeValue: value, sizeUnit: unit, size: { value, unit }, stock, sku: `${flavor}-${value}`, price: 10 }) as never;

describe("Presentaciones (C47, C63)", () => {
  it("usa coma decimal y no repite el formato que ya dice el tamaño", () => {
    expect(sizeLabel(variant("Chocolate", 1.6, "lb"))).toBe("1,6 lb");
    expect(presentationLabel(variant("Gourmet Chocolate", 5.5, "lb"))).toBe("Gourmet Chocolate · 5,5 lb");
    expect(presentationLabel(variant("Cápsulas", 60, "cápsulas"))).toBe("60 cápsulas");
    expect(presentationLabel(variant("", 300, "g"))).toBe("300 g");
  });
  it("resume tamaños y sabores sin decir «presentaciones»", () => {
    expect(presentationSummary({ variants: [variant("A", 2, "lb"), variant("B", 2, "lb"), variant("A", 5, "lb")] }).text).toBe("2 lb · 5 lb · 2 sabores");
    expect(LOW_STOCK).toBe(5);
  });
});
