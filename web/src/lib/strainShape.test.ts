import { describe, expect, it } from "vitest";
import { autoStrainScale, strainShape, type StrainState } from "./strainShape";

const ZERO: StrainState = {
  epsilon_x: 0,
  epsilon_y: 0,
  gamma_xy: 0,
  kappa_x: 0,
  kappa_y: 0,
  kappa_xy: 0,
};

const at = (shape: ReturnType<typeof strainShape>, row: number, col: number) =>
  shape.points[row][col].position;

describe("strainShape", () => {
  it("leaves an unloaded laminate as the unit square", () => {
    const shape = strainShape(ZERO, 5, 1);
    expect(shape.peak).toBe(0);
    expect(at(shape, 0, 0)).toEqual([-0.5, -0.5, 0]);
    expect(at(shape, 4, 4)).toEqual([0.5, 0.5, 0]);
    for (const row of shape.points) for (const p of row) expect(p.position[2]).toBe(0);
  });

  it("stretches along x for eps_x and leaves y alone", () => {
    const shape = strainShape({ ...ZERO, epsilon_x: 0.1 }, 3, 1);
    // The edges move out by eps_x/2 each; the centre line does not move.
    expect(at(shape, 1, 0)[0]).toBeCloseTo(-0.5 - 0.05, 12);
    expect(at(shape, 1, 2)[0]).toBeCloseTo(0.5 + 0.05, 12);
    expect(at(shape, 1, 1)[0]).toBeCloseTo(0, 12);
    for (const row of shape.points) for (const p of row) expect(p.position[1]).toBeCloseTo(p.position[1], 12);
    expect(at(shape, 0, 1)[1]).toBeCloseTo(-0.5, 12);
  });

  it("shears the square into a rhombus, splitting gamma between the two directions", () => {
    // Engineering shear: the total change of the right angle is gamma, and the
    // two directions take half each. A corner at (0.5, 0.5) therefore moves by
    // gamma/2 * 0.5 in BOTH x and y.
    const shape = strainShape({ ...ZERO, gamma_xy: 0.2 }, 3, 1);
    const corner = at(shape, 2, 2);
    expect(corner[0]).toBeCloseTo(0.5 + 0.05, 12);
    expect(corner[1]).toBeCloseTo(0.5 + 0.05, 12);
    // The opposite corner moves the other way, so the square stays a rhombus.
    const opposite = at(shape, 0, 0);
    expect(opposite[0]).toBeCloseTo(-0.5 - 0.05, 12);
    expect(opposite[1]).toBeCloseTo(-0.5 - 0.05, 12);
    // And nothing leaves the plane.
    expect(corner[2]).toBe(0);
  });

  it("bends the square into a cylinder for kappa_x, the way the plate modules sign it", () => {
    // w = -kappa_x x^2 / 2: a positive curvature pulls the edges DOWN, which is
    // the sign convention settled for the plate deformation module.
    const shape = strainShape({ ...ZERO, kappa_x: 0.4 }, 3, 1);
    expect(at(shape, 1, 1)[2]).toBeCloseTo(0, 12);
    expect(at(shape, 1, 0)[2]).toBeCloseTo(-0.4 * 0.25 * 0.5, 12);
    expect(at(shape, 1, 2)[2]).toBeCloseTo(-0.4 * 0.25 * 0.5, 12);
    // Nothing happens along y.
    expect(at(shape, 0, 1)[2]).toBeCloseTo(0, 12);
  });

  it("twists into a saddle for kappa_xy: opposite corners go opposite ways", () => {
    const shape = strainShape({ ...ZERO, kappa_xy: 0.4 }, 3, 1);
    const a = at(shape, 2, 2)[2];
    const b = at(shape, 0, 0)[2];
    const c = at(shape, 0, 2)[2];
    const d = at(shape, 2, 0)[2];
    expect(a).toBeCloseTo(b, 12);
    expect(c).toBeCloseTo(d, 12);
    expect(Math.sign(a)).toBe(-Math.sign(c));
    expect(Math.abs(a)).toBeGreaterThan(0);
  });

  it("scales the displacement and not the square", () => {
    const plain = strainShape({ ...ZERO, kappa_x: 0.4 }, 3, 1);
    const stretched = strainShape({ ...ZERO, kappa_x: 0.4 }, 3, 10);
    expect(at(stretched, 1, 0)[2]).toBeCloseTo(10 * at(plain, 1, 0)[2], 12);
    // The in-plane extent of an unloaded direction is untouched by the scale.
    expect(at(stretched, 0, 0)[1]).toBeCloseTo(-0.5, 12);
    // And the reported magnitude is the REAL one, before exaggeration.
    expect(stretched.peak).toBeCloseTo(plain.peak, 12);
  });

  it("reports the peak displacement, which is what the auto scale works from", () => {
    const shape = strainShape({ ...ZERO, epsilon_x: 0.1 }, 3, 1);
    expect(shape.peak).toBeCloseTo(0.05, 12);
    expect(autoStrainScale(shape.peak, 0.25)).toBeCloseTo(5, 12);
    // A load case that does nothing must not divide by zero.
    expect(autoStrainScale(0)).toBe(1);
    expect(autoStrainScale(Number.NaN)).toBe(1);
  });
});
