import { describe, expect, it } from "vitest";
import { buildPlateBody, type PlateBodyInput } from "./body";

// Tolerances are float32, not float64: everything that comes back out of a
// PlateBody has been through a Float32Array on its way to a vertex buffer, so
// seven places is the honest bar and twelve would only be testing the type.
//
// What can be wrong here without looking wrong: the drawn thickness, the
// winding, and above all the normals. A normal taken from the unexaggerated
// field still points somewhere plausible - the body just lights as though it
// were flat. That is why the slope cases below check numbers rather than
// "renders without throwing".

function flat(rows: number, cols: number, value = 0): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}

const base: PlateBodyInput = {
  surface: flat(3, 3),
  length: 100,
  width: 100,
  thickness: 2,
  deflectionScale: 1,
  thicknessScale: 1,
  plyBoundaries: [-0.5, 0, 0.5],
};

function vertex(body: ReturnType<typeof buildPlateBody>, index: number) {
  return [
    body.positions[index * 3],
    body.positions[index * 3 + 1],
    body.positions[index * 3 + 2],
  ];
}

function normal(body: ReturnType<typeof buildPlateBody>, index: number) {
  return [body.normals[index * 3], body.normals[index * 3 + 1], body.normals[index * 3 + 2]];
}

/** Compares component-wise: float32 resolution, and -0 is 0. */
function expectNormal(actual: number[], expected: number[]) {
  for (const [channel, value] of expected.entries()) {
    expect(actual[channel]).toBeCloseTo(value, 6);
  }
}

describe("buildPlateBody", () => {
  it("offsets a flat plate by half its thickness, each way", () => {
    const body = buildPlateBody(base);
    // World units scale the longer edge to 1, so 2 mm on a 100 mm plate is
    // 0.02 thick, i.e. 0.01 either side of the mid-surface.
    expect(body.frame.halfThickness).toBeCloseTo(0.01, 8);

    const points = 3 * 3;
    for (let i = 0; i < points; i++) {
      expect(vertex(body, i)[2]).toBeCloseTo(0.01, 8);
      expectNormal(normal(body, i), [0, 0, 1]);
      expect(vertex(body, points + i)[2]).toBeCloseTo(-0.01, 8);
      expectNormal(normal(body, points + i), [0, 0, -1]);
    }
  });

  it("counts vertices, triangles and lines the way the draw calls expect", () => {
    const body = buildPlateBody(base);
    // top + bottom grids, then two vertices per sample along each of four edges
    expect(body.positions.length / 3).toBe(2 * 9 + 4 * 3 * 2);
    expect(body.values.length).toBe(body.positions.length / 3);
    expect(body.normals.length).toBe(body.positions.length);
    // 2x2 quads on each face, plus 2 quads along each of the four edges
    expect(body.indices.length).toBe((4 + 4 + 4 * 2) * 6);
    // one polyline per edge and boundary, two segments each, two points each
    expect(body.plyLines.length).toBe(4 * 3 * 2 * 2 * 3);
    expect(body.outline.length).toBe(8 * 3);
  });

  it("never indexes past the vertices it built", () => {
    const body = buildPlateBody({ ...base, surface: flat(5, 4) });
    const count = body.positions.length / 3;
    for (const index of body.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(count);
    }
  });

  it("carries the field value to every vertex, sides included", () => {
    const surface = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const body = buildPlateBody({ ...base, surface });
    expect([...body.values.slice(0, 9)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect([...body.values.slice(9, 18)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // The first side face runs along y = 0, so its samples carry the first row,
    // each value twice - once for the lower vertex, once for the upper.
    expect([...body.values.slice(18, 24)]).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("takes the normal from the slope of the drawn field", () => {
    // A ramp of one unit per column. In world units the columns are 0.5 apart
    // and one unit of deflection is 0.01, so the slope is 0.02.
    const surface = [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ];
    const body = buildPlateBody({ ...base, surface });
    const expected = [-0.02, 0, 1];
    const norm = Math.hypot(...expected);
    expectNormal(normal(body, 4), [
      expected[0] / norm,
      expected[1] / norm,
      expected[2] / norm,
    ]);
  });

  it("lets the exaggeration into the normal, not only into the silhouette", () => {
    const surface = [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ];
    const plain = buildPlateBody({ ...base, surface });
    const doubled = buildPlateBody({ ...base, surface, deflectionScale: 2 });
    // Twice the exaggeration is twice the slope, so the normal tilts further.
    const slopeOf = (body: ReturnType<typeof buildPlateBody>) => {
      const [nx, , nz] = normal(body, 4);
      return -nx / nz;
    };
    expect(slopeOf(doubled)).toBeCloseTo(2 * slopeOf(plain), 7);
  });

  it("offsets the faces along the normal, so the section stays perpendicular", () => {
    const surface = [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ];
    const body = buildPlateBody({ ...base, surface });
    const centre = 4;
    const top = vertex(body, centre);
    const bottom = vertex(body, 9 + centre);
    const along = [top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2]];
    // The section is tilted, so it is NOT a pure z offset ...
    expect(Math.abs(along[0])).toBeGreaterThan(0);
    // ... and it is exactly one thickness long.
    expect(Math.hypot(...along)).toBeCloseTo(2 * body.frame.halfThickness, 8);
  });

  it("thickens a plate that would otherwise be a sheet", () => {
    const body = buildPlateBody({ ...base, thicknessScale: 5 });
    expect(body.frame.halfThickness).toBeCloseTo(0.05, 12);
  });

  it("returns nothing to draw for a degenerate grid", () => {
    const body = buildPlateBody({ ...base, surface: [[0]] });
    expect(body.positions.length).toBe(0);
    expect(body.indices.length).toBe(0);
  });
});
