import { describe, expect, it } from "vitest";
import { plateFrame } from "./frame";
import {
  edgeFlowArrows,
  heightSampler,
  loadMesh,
  transverseLoadArrows,
  type LoadArrow,
} from "./loads";
import type { NamedLoad } from "../generated/NamedLoad";

const frame = plateFrame({ length: 400, width: 200, thickness: 2, thicknessScale: 10 });
const flat = () => 0;

const surface = (force: number): NamedLoad => ({ name: "p", kind: "Surface", force });
const point = (x: number, y: number, force: number): NamedLoad => ({
  name: "F",
  kind: "Point",
  x,
  y,
  force,
});

const tailOf = (arrow: LoadArrow) => [
  arrow.tip[0] - arrow.direction[0] * arrow.length,
  arrow.tip[1] - arrow.direction[1] * arrow.length,
  arrow.tip[2] - arrow.direction[2] * arrow.length,
];

describe("transverseLoadArrows", () => {
  it("points a positive load up and puts its tips on the underside", () => {
    // Positive is +z because that is the sign the core returns as a positive
    // deflection; an arrow that pushed the other way would contradict the
    // body it stands next to.
    const { arrows } = transverseLoadArrows([surface(1)], frame, flat);
    expect(arrows.length).toBeGreaterThan(0);
    for (const arrow of arrows) {
      expect(arrow.direction).toEqual([0, 0, 1]);
      expect(arrow.tip[2]).toBeCloseTo(-frame.halfThickness, 12);
      expect(tailOf(arrow)[2]).toBeLessThan(arrow.tip[2]);
    }
  });

  it("points a negative load down and puts its tips on the top face", () => {
    const { arrows } = transverseLoadArrows([surface(-1)], frame, flat);
    for (const arrow of arrows) {
      expect(arrow.direction).toEqual([0, 0, -1]);
      expect(arrow.tip[2]).toBeCloseTo(frame.halfThickness, 12);
      expect(tailOf(arrow)[2]).toBeGreaterThan(arrow.tip[2]);
    }
  });

  it("follows the deflected surface rather than the flat plate", () => {
    const bowl = (u: number, v: number) => 0.1 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
    const { arrows } = transverseLoadArrows([surface(-1)], frame, bowl);
    const heights = arrows.map((arrow) => arrow.tip[2]);
    expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights));
  });

  it("keeps every arrow over the plate", () => {
    const { arrows } = transverseLoadArrows([surface(-2)], frame, flat);
    for (const arrow of arrows) {
      expect(Math.abs(arrow.tip[0])).toBeLessThanOrEqual(frame.halfLength);
      expect(Math.abs(arrow.tip[1])).toBeLessThanOrEqual(frame.halfWidth);
    }
  });

  it("places a point load where it acts, measured from the centre", () => {
    const { arrows } = transverseLoadArrows([point(100, -50, -3)], frame, flat);
    expect(arrows).toHaveLength(1);
    expect(arrows[0].tip[0]).toBeCloseTo(100 * frame.scale, 12);
    expect(arrows[0].tip[1]).toBeCloseTo(-50 * frame.scale, 12);
  });

  it("holds a point load outside the plate at the edge instead of drawing off it", () => {
    const { arrows } = transverseLoadArrows([point(10_000, 0, -1)], frame, flat);
    expect(arrows[0].tip[0]).toBeCloseTo(frame.halfLength, 12);
  });

  it("names each load once and anchors the caption clear of the arrow", () => {
    const { labels } = transverseLoadArrows([surface(-1), point(0, 0, -5)], frame, flat);
    expect(labels.map((label) => label.name)).toEqual(["p", "F"]);
    expect(labels.map((label) => label.unit)).toEqual(["pressure", "force"]);
    // Both press downwards, so both captions sit above the plate - and above
    // the arrows, not inside them.
    for (const label of labels) expect(label.at[2]).toBeGreaterThan(frame.halfThickness);
    // Stacked, so two captions on the same spot do not print over each other.
    expect(labels[0].at[2]).not.toBeCloseTo(labels[1].at[2], 6);
  });

  it("draws nothing for a load of zero or a load that is not a number", () => {
    expect(transverseLoadArrows([surface(0)], frame, flat).arrows).toHaveLength(0);
    expect(transverseLoadArrows([surface(NaN)], frame, flat).arrows).toHaveLength(0);
    expect(transverseLoadArrows([], frame, flat).labels).toHaveLength(0);
  });
});

describe("edgeFlowArrows", () => {
  /** A shear arrow straddles its edge, so its centre is where it acts. */
  const centreOf = (arrow: LoadArrow) => [
    arrow.tip[0] - (arrow.direction[0] * arrow.length) / 2,
    arrow.tip[1] - (arrow.direction[1] * arrow.length) / 2,
  ];

  it("presses a compressive flow onto the edge it acts on", () => {
    // n_x = -1 is the compression the buckling tests solve for, so it must be
    // the one drawn pointing into the plate.
    const { arrows } = edgeFlowArrows(-1, 0, 0, frame);
    expect(arrows.length).toBeGreaterThan(0);
    for (const arrow of arrows) {
      // The tip sits on one of the two edges normal to x...
      expect(Math.abs(arrow.tip[0])).toBeCloseTo(frame.halfLength, 12);
      // ...and the arrow points from outside towards the plate centre.
      expect(arrow.direction[0] * Math.sign(arrow.tip[0])).toBeLessThan(0);
    }
  });

  it("pulls a tensile flow away from the edge", () => {
    const { arrows } = edgeFlowArrows(1, 0, 0, frame);
    for (const arrow of arrows) {
      expect(arrow.direction[0] * Math.sign(arrow.tip[0])).toBeGreaterThan(0);
      expect(Math.abs(arrow.tip[0])).toBeGreaterThan(frame.halfLength);
    }
  });

  it("puts n_y on the edges normal to y", () => {
    const { arrows } = edgeFlowArrows(0, -1, 0, frame);
    expect(arrows.length).toBeGreaterThan(0);
    for (const arrow of arrows) {
      expect(Math.abs(arrow.tip[1])).toBeCloseTo(frame.halfWidth, 12);
      expect(arrow.direction[0]).toBeCloseTo(0, 12);
    }
  });

  it("runs a shear flow along each edge, the four agreeing at the corners", () => {
    // Traction of a shear flow is the outward normal with its two components
    // swapped: tangential on every edge, and converging on one diagonal pair
    // of corners - the picture of pure shear rather than four unrelated loads.
    const { arrows } = edgeFlowArrows(0, 0, 1, frame);
    const on = (axis: 0 | 1, coordinate: number) =>
      arrows.filter((arrow) => Math.abs(centreOf(arrow)[axis] - coordinate) < 1e-9);

    const right = on(0, frame.halfLength);
    const top = on(1, frame.halfWidth);
    expect(right.length).toBeGreaterThan(0);
    expect(top.length).toBeGreaterThan(0);
    for (const arrow of right) expect(arrow.direction).toEqual([0, 1, 0]);
    for (const arrow of top) expect(arrow.direction).toEqual([1, 0, 0]);
    // The opposite edges carry the counter-tractions.
    for (const arrow of on(0, -frame.halfLength)) expect(arrow.direction[1]).toBe(-1);
    for (const arrow of on(1, -frame.halfWidth)) expect(arrow.direction[0]).toBe(-1);
  });

  it("reverses the whole circulation with the sign of n_xy", () => {
    const positive = edgeFlowArrows(0, 0, 1, frame).arrows;
    const negative = edgeFlowArrows(0, 0, -1, frame).arrows;
    expect(negative).toHaveLength(positive.length);
    for (let i = 0; i < positive.length; i++) {
      expect(negative[i].direction[0]).toBeCloseTo(-positive[i].direction[0], 12);
      expect(negative[i].direction[1]).toBeCloseTo(-positive[i].direction[1], 12);
    }
  });

  it("scales the arrows against the largest flow, since only the ratio means anything", () => {
    const { arrows } = edgeFlowArrows(-1, -0.25, 0, frame);
    const alongX = arrows.filter((a) => a.direction[0] !== 0);
    const alongY = arrows.filter((a) => a.direction[1] !== 0);
    expect(alongX[0].length).toBeGreaterThan(alongY[0].length);
    // Doubling both changes nothing: the result scales all three by one factor.
    const doubled = edgeFlowArrows(-2, -0.5, 0, frame).arrows;
    expect(doubled[0].length).toBeCloseTo(arrows[0].length, 12);
  });

  it("draws nothing when no flow is applied", () => {
    expect(edgeFlowArrows(0, 0, 0, frame).arrows).toHaveLength(0);
    expect(edgeFlowArrows(NaN, 0, 0, frame).arrows).toHaveLength(0);
  });

  it("names only the components that are actually applied", () => {
    const { labels } = edgeFlowArrows(-1, 0, 0.5, frame);
    expect(labels.map((label) => label.name)).toEqual(["nx", "nxy"]);
  });
});

describe("heightSampler", () => {
  // Rows along y, columns along x - swapping the two is the mistake that
  // survives every symmetric test case, so the grid here is asymmetric.
  const grid = [
    [0, 0, 0],
    [1, 2, 3],
  ];

  it("reads rows along y and columns along x", () => {
    const at = heightSampler(grid, 1, 1);
    expect(at(0, 0)).toBeCloseTo(0, 12);
    expect(at(1, 1)).toBeCloseTo(3, 12);
    expect(at(0, 1)).toBeCloseTo(1, 12);
    expect(at(1, 0)).toBeCloseTo(0, 12);
  });

  it("interpolates between the samples and applies both scales", () => {
    expect(heightSampler(grid, 1, 1)(0.5, 1)).toBeCloseTo(2, 12);
    expect(heightSampler(grid, 2, 0.5)(1, 1)).toBeCloseTo(3, 12);
  });

  it("holds a hole in the field at the flat plate instead of losing the arrow", () => {
    const holed = [
      [0, 0],
      [NaN, 0],
    ];
    expect(heightSampler(holed, 1, 1)(0, 1)).toBe(0);
  });

  it("reads a grid too small to interpolate as flat", () => {
    expect(heightSampler([[1]], 1, 1)(0.5, 0.5)).toBe(0);
    expect(heightSampler([], 1, 1)(0.5, 0.5)).toBe(0);
  });
});

describe("loadMesh", () => {
  it("gives every arrow a shaft and a head", () => {
    const one = loadMesh(transverseLoadArrows([point(0, 0, -1)], frame, flat));
    expect(one.lines.length).toBe(6);
    expect(one.positions.length).toBeGreaterThan(0);
    expect(one.normals.length).toBe(one.positions.length);
  });

  it("stops the shaft where the head begins, so it cannot poke through the tip", () => {
    const { arrows } = transverseLoadArrows([point(0, 0, -1)], frame, flat);
    const mesh = loadMesh({ arrows, labels: [] });
    const shaftEnd = mesh.lines.slice(3, 6);
    expect(shaftEnd[2]).toBeGreaterThan(arrows[0].tip[2]);
  });
});
