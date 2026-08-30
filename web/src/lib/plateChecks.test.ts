import { describe, expect, it } from "vitest";
import { hasBlockingCheck, plateChecks, type PlateGeometry } from "./plateChecks";

const square: PlateGeometry = { length: 500, width: 500, bc_x: "SS", bc_y: "SS", m: 10 };

describe("plateChecks", () => {
  it("passes a square plate with the default term count", () => {
    expect(plateChecks(square)).toEqual([]);
  });

  it("rejects a plate that is free on all four edges", () => {
    const checks = plateChecks({ ...square, bc_x: "FF", bc_y: "FF" });
    expect(checks).toEqual([{ severity: "error", message: "plate.check.freeEdges" }]);
    expect(hasBlockingCheck(checks)).toBe(true);
  });

  it("allows free edges in one direction only", () => {
    expect(plateChecks({ ...square, bc_x: "FF", bc_y: "SS" })).toEqual([]);
  });

  // The case that made this file exist: 5000 x 250 mm at the default 10 terms
  // reports a buckling factor of 0.292, where 20 terms give 0.149.
  it("warns when the plate is longer than the series can resolve", () => {
    const checks = plateChecks({ ...square, length: 5000, width: 250 });
    expect(checks).toEqual([{ severity: "warning", message: "plate.check.terms" }]);
    expect(hasBlockingCheck(checks)).toBe(false);
  });

  it("warns for the same ratio the other way round", () => {
    expect(plateChecks({ ...square, length: 250, width: 5000 })).toHaveLength(1);
  });

  it("takes the exact boundary the original takes", () => {
    // ratio == m is fine, anything past it is not.
    expect(plateChecks({ ...square, length: 5000, width: 500, m: 10 })).toEqual([]);
    expect(plateChecks({ ...square, length: 5001, width: 500, m: 10 })).toHaveLength(1);
    // ...and 1/m at the lower end.
    expect(plateChecks({ ...square, length: 500, width: 5000, m: 10 })).toEqual([]);
    expect(plateChecks({ ...square, length: 499, width: 5000, m: 10 })).toHaveLength(1);
  });

  it("says nothing about a degenerate plate - that is the core's error", () => {
    expect(plateChecks({ ...square, width: 0 })).toEqual([]);
    expect(plateChecks({ ...square, m: 0 })).toEqual([]);
  });
});
