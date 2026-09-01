import { describe, expect, it } from "vitest";
import { plyGeometryOf, UNKNOWN_PLY_GEOMETRY } from "./plyGeometry";
import type { LayerContributionDto } from "../types";

// Only `thickness`, `zm` and `angle_deg` are read; the rest of the DTO is the
// ABD build-up the "how was this computed" panels use.
function ply(thickness: number, zm: number, angleDeg = 0): LayerContributionDto {
  return {
    layer_number: 0,
    angle_deg: angleDeg,
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

describe("the fibre angles", () => {
  it("come back bottom-up, in radians, one per band", () => {
    // Given in stacking order, which is not the drawn order.
    const geometry = plyGeometryOf([ply(0.5, 0.25, 90), ply(0.5, -0.25, 0)]);
    expect(geometry.boundaries).toEqual([-0.5, 0, 0.5]);
    expect(geometry.angles).toHaveLength(2);
    expect(geometry.angles[0]).toBeCloseTo(0, 12);
    expect(geometry.angles[1]).toBeCloseTo(Math.PI / 2, 12);
  });

  it("gives an unknown stack one band to draw", () => {
    expect(plyGeometryOf(null).angles).toHaveLength(1);
    expect(plyGeometryOf(null).boundaries).toHaveLength(2);
  });
});

describe("the band-to-layer map", () => {
  it("inverts the core's top-down stacking order", () => {
    // CltLaminate puts layer 0 at +t/2 and works downwards, so the FIRST
    // contribution is the topmost band. Highlighting a ply by its core index
    // without this map lights up its mirror image - and on a symmetric
    // laminate that would look perfectly right.
    const geometry = plyGeometryOf([ply(0.5, 0.25, 90), ply(0.5, -0.25, 0)]);
    expect(geometry.layerIndices).toEqual([1, 0]);
    // The angles follow the same bottom-up order.
    expect(geometry.angles[0]).toBeCloseTo(0, 12);
  });

  it("leaves an already bottom-up stack alone", () => {
    const geometry = plyGeometryOf([ply(0.5, -0.25, 0), ply(0.5, 0.25, 90)]);
    expect(geometry.layerIndices).toEqual([0, 1]);
  });
});
