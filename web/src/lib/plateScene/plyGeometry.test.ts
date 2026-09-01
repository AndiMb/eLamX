import { describe, expect, it } from "vitest";
import { plyGeometryOf, UNKNOWN_PLY_GEOMETRY } from "./plyGeometry";
import type { LayerContributionDto } from "../types";

// Only `thickness` and `zm` are read; the rest of the DTO is the ABD build-up
// the "how was this computed" panels use.
function ply(thickness: number, zm: number): LayerContributionDto {
  return {
    layer_number: 0,
    angle_deg: 0,
    thickness,
    zm,
    material_id: "m",
    criterion_id: null,
    q_global: [],
    a_contribution: [],
    b_contribution: [],
    d_contribution: [],
  };
}

describe("plyGeometryOf", () => {
  it("adds the stack up and puts the interfaces between the faces", () => {
    // Four plies of 0.25, centred: faces at -0.5, -0.25, 0, 0.25, 0.5.
    const geometry = plyGeometryOf([
      ply(0.25, -0.375),
      ply(0.25, -0.125),
      ply(0.25, 0.125),
      ply(0.25, 0.375),
    ]);
    expect(geometry.thickness).toBeCloseTo(1, 12);
    expect(geometry.boundaries).toEqual([-0.5, -0.25, 0, 0.25, 0.5]);
  });

  it("counts a shared interface once", () => {
    const geometry = plyGeometryOf([ply(1, -0.5), ply(1, 0.5)]);
    expect(geometry.boundaries).toEqual([-0.5, 0, 0.5]);
  });

  it("measures from the middle of the stack, not from z = 0", () => {
    // The same two plies, but with the reference plane at the bottom face.
    const geometry = plyGeometryOf([ply(1, 0.5), ply(1, 1.5)]);
    expect(geometry.thickness).toBeCloseTo(2, 12);
    expect(geometry.boundaries).toEqual([-0.5, 0, 0.5]);
  });

  it("says so when the stack is not known yet", () => {
    expect(plyGeometryOf(null)).toBe(UNKNOWN_PLY_GEOMETRY);
    expect(plyGeometryOf([])).toBe(UNKNOWN_PLY_GEOMETRY);
    expect(plyGeometryOf([ply(0, 0)])).toBe(UNKNOWN_PLY_GEOMETRY);
  });
});
