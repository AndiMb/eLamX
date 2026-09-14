import { describe, expect, it } from "vitest";
import { plateFrame } from "./frame";
import { stiffenerMesh, stiffenerRibbons } from "./stiffeners";
import type { Stiffener } from "../generated/Stiffener";

// Deliberately not square, and not the same in x and y: a plate of 400 x 200
// is what separates "runs along x" from "runs along y" and a position measured
// from the centre from one measured from an edge.
const frame = plateFrame({ length: 400, width: 200, thickness: 2, thicknessScale: 10 });
const FLAT = () => 0;

const blade = (direction: "x" | "y", position: number): Stiffener => ({
  name: `s-${direction}`,
  direction,
  position,
  profile: "i_profile",
  w1: 30,
  t1: 3,
  e: 70000,
  g: 27000,
  rho: 2.7e-9,
});

describe("stiffenerRibbons", () => {
  it("runs an x stiffener along x at a constant y taken from the plate centre", () => {
    const [ribbon] = stiffenerRibbons([blade("x", 50)], frame, FLAT);
    const xs = ribbon.foot.map((p) => p[0]);
    const ys = ribbon.foot.map((p) => p[1]);

    expect(Math.min(...xs)).toBeCloseTo(-frame.halfLength, 12);
    expect(Math.max(...xs)).toBeCloseTo(frame.halfLength, 12);
    // 50 mm from the centre of a 200 mm wide plate is a quarter of the way out.
    for (const y of ys) expect(y).toBeCloseTo(frame.halfWidth / 2, 12);
  });

  it("runs a y stiffener along y at a constant x", () => {
    const [ribbon] = stiffenerRibbons([blade("y", -100)], frame, FLAT);
    const xs = ribbon.foot.map((p) => p[0]);
    const ys = ribbon.foot.map((p) => p[1]);

    for (const x of xs) expect(x).toBeCloseTo(-frame.halfLength / 2, 12);
    expect(Math.min(...ys)).toBeCloseTo(-frame.halfWidth, 12);
    expect(Math.max(...ys)).toBeCloseTo(frame.halfWidth, 12);
  });

  it("stands the ribbon on the deformed top face, not on the mid-plane", () => {
    // A bump in the middle: the foot has to rise with it, otherwise the
    // stiffener would cut through a plate it is supposed to be glued to.
    const bump = (u: number) => 0.1 * Math.sin(Math.PI * u);
    const [ribbon] = stiffenerRibbons([blade("x", 0)], frame, (u) => bump(u));
    const middle = ribbon.foot[(ribbon.foot.length - 1) / 2];
    expect(middle[2]).toBeCloseTo(bump(0.5) + frame.halfThickness, 12);
    expect(ribbon.foot[0][2]).toBeCloseTo(frame.halfThickness, 12);
  });

  it("draws the height true to the plate's span, not to the drawn thickness", () => {
    // The frame exaggerates the laminate ten-fold here. A stiffener that
    // followed that would be a wall: the exaggeration exists to make a
    // sub-millimetre laminate visible, and a stiffener is already tens of
    // millimetres tall. 30 mm on a 400 mm plate is 30/400 of a world unit.
    const [ribbon] = stiffenerRibbons([blade("x", 0)], frame, FLAT);
    expect(ribbon.height).toBeCloseTo(30 / 400, 12);
    expect(ribbon.height).toBeLessThan(frame.halfLength);
  });

  it("gives only the T profile a flange, and it the width of its own w1", () => {
    const t: Stiffener = {
      name: "t",
      direction: "x",
      position: 0,
      profile: "t_profile",
      w1: 24,
      t1: 2,
      w2: 30,
      t2: 3,
      e: 70000,
      g: 27000,
      rho: 2.7e-9,
    };
    const [ribbon] = stiffenerRibbons([t], frame, FLAT);
    expect(ribbon.flangeHalf).toBeCloseTo(12 / 400, 12);
    // Its height is the WEB, w2 - the flange sits on top of it, it is not it.
    expect(ribbon.height).toBeCloseTo(30 / 400, 12);
    expect(stiffenerRibbons([blade("x", 0)], frame, FLAT)[0].flangeHalf).toBe(0);
  });

  it("draws the direct input as a token ribbon rather than inventing a height", () => {
    const direct: Stiffener = {
      name: "frei",
      direction: "x",
      position: 0,
      profile: "direct",
      e: 70000,
      i: 27000,
      g: 27000,
      j: 270,
      a: 90,
      rho: 2.7e-9,
    };
    const [ribbon] = stiffenerRibbons([direct], frame, FLAT);
    expect(ribbon.height).toBeGreaterThan(0);
    expect(ribbon.flangeHalf).toBe(0);
  });

  it("skips a stiffener that is not on the plate at all", () => {
    // Past the edge there is no surface to stand on. The analysis still uses
    // the stiffener, which is why the editor warns in words - drawing a beam
    // hovering beside the plate would suggest a geometry nobody meant.
    expect(stiffenerRibbons([blade("x", 400)], frame, FLAT)).toEqual([]);
    expect(stiffenerRibbons([blade("y", -1000)], frame, FLAT)).toEqual([]);
    expect(stiffenerRibbons([blade("x", Number.NaN)], frame, FLAT)).toEqual([]);
    // Exactly on the edge is still on the plate.
    expect(stiffenerRibbons([blade("x", 100)], frame, FLAT)).toHaveLength(1);
  });
});

describe("stiffenerMesh", () => {
  it("builds a closed ribbon and a top line for every stiffener", () => {
    const ribbons = stiffenerRibbons([blade("x", 0), blade("y", 0)], frame, FLAT);
    const mesh = stiffenerMesh(ribbons);
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.lines.length).toBeGreaterThan(0);
    // Two triangles per segment per ribbon, three vertices of three floats.
    const segments = (ribbons[0].foot.length - 1) * ribbons.length;
    expect(mesh.positions.length).toBe(segments * 2 * 3 * 3);
  });

  it("puts the top edge exactly one web height above the foot", () => {
    const [ribbon] = stiffenerRibbons([blade("x", 0)], frame, FLAT);
    const mesh = stiffenerMesh([ribbon]);
    const zs: number[] = [];
    for (let i = 2; i < mesh.lines.length; i += 3) zs.push(mesh.lines[i]);
    // Precision 6, not 12: the mesh is a Float32Array.
    for (const z of zs) expect(z).toBeCloseTo(frame.halfThickness + ribbon.height, 6);
  });

  it("draws nothing for no stiffeners", () => {
    const mesh = stiffenerMesh([]);
    expect(mesh.positions.length).toBe(0);
    expect(mesh.lines.length).toBe(0);
  });
});
