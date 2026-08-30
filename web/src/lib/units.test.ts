import { describe, expect, it } from "vitest";
import { CATEGORY_DEFINITIONS, type QuantityCategory } from "./units";

const categories = Object.keys(CATEGORY_DEFINITIONS) as QuantityCategory[];

describe("the unit catalog", () => {
  it("round-trips every unit, so an unchanged field cannot drift", () => {
    // Quantity converts canonical -> display on render and back on edit. If
    // the pair were not inverse, opening a laminate and saving it without
    // touching anything would change its numbers.
    for (const category of categories) {
      for (const unit of CATEGORY_DEFINITIONS[category].units ?? []) {
        for (const canonical of [-273.15, -1.5, 0, 1e-9, 0.125, 140000]) {
          const round = unit.toCanonical(unit.fromCanonical(canonical));
          expect(round).toBeCloseTo(canonical, 9);
        }
      }
    }
  });

  it("names a default unit exactly when it has units to choose from", () => {
    for (const category of categories) {
      const def = CATEGORY_DEFINITIONS[category];
      if (def.units === null) {
        expect(def.defaultUnitId).toBeNull();
      } else {
        expect(def.units.some((u) => u.id === def.defaultUnitId)).toBe(true);
      }
    }
  });

  it("keeps the canonical unit the one the core actually uses", () => {
    // The core works in MPa, mm, degrees - a display unit converts to these,
    // never the other way round.
    expect(CATEGORY_DEFINITIONS.stiffness.units?.find((u) => u.id === "MPa")?.toCanonical(7)).toBe(7);
    expect(CATEGORY_DEFINITIONS.thickness.units?.find((u) => u.id === "mm")?.toCanonical(7)).toBe(7);
    expect(CATEGORY_DEFINITIONS.angle.units?.find((u) => u.id === "deg")?.toCanonical(7)).toBe(7);
  });

  it("converts the units an engineer would check by hand", () => {
    const mm = (id: string) => CATEGORY_DEFINITIONS.thickness.units?.find((u) => u.id === id);
    expect(mm("in")?.toCanonical(1)).toBeCloseTo(25.4, 9);
    expect(mm("m")?.fromCanonical(1000)).toBeCloseTo(1, 9);

    const stiffness = (id: string) => CATEGORY_DEFINITIONS.stiffness.units?.find((u) => u.id === id);
    expect(stiffness("GPa")?.toCanonical(140)).toBeCloseTo(140000, 6);

    const angle = (id: string) => CATEGORY_DEFINITIONS.angle.units?.find((u) => u.id === id);
    expect(angle("rad")?.toCanonical(Math.PI)).toBeCloseTo(180, 9);
  });

  it("treats absolute temperature as affine, not as a scale factor", () => {
    // The one category where 0 does not map to 0 - hence its separation from
    // temperatureDelta, where a difference of 1 °C IS a difference of 1 K.
    const kelvin = CATEGORY_DEFINITIONS.temperature.units?.find((u) => u.id === "K");
    expect(kelvin?.toCanonical(273.15)).toBeCloseTo(0, 9);
    expect(kelvin?.fromCanonical(0)).toBeCloseTo(273.15, 9);

    // A delta, by contrast, has to be linear through zero in every unit -
    // that IS the difference between the two categories. (There is no separate
    // Kelvin entry: a temperature difference in K and in °C is the same
    // number, which is why the unit is labelled "Δ°C / ΔK".)
    for (const unit of CATEGORY_DEFINITIONS.temperatureDelta.units ?? []) {
      expect(unit.toCanonical(0)).toBe(0);
      expect(unit.fromCanonical(0)).toBe(0);
    }
    const deltaFahrenheit = CATEGORY_DEFINITIONS.temperatureDelta.units?.find((u) => u.id === "dF");
    expect(deltaFahrenheit?.toCanonical(9)).toBeCloseTo(5, 9);
  });
});
