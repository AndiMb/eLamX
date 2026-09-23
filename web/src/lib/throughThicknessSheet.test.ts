import { describe, expect, it } from "vitest";
import { metricRange, plyAt, valueAt, valueRange, verticalScale, type SheetPly, type Triple } from "./throughThicknessSheet";

const rf = (v: number) => ({ failure_name: "", minimal_reserve_factor: v, failure_type: "FiberFailure" as const });
const pair = (lower: Triple, upper: Triple) => ({ lower, upper });

/** Two plies, 0.2 over 0.1 mm, z from +0.15 to -0.15. */
const plies: SheetPly[] = [
  {
    number: 1,
    angle: 0,
    materialId: "m",
    zLower: -0.05,
    zUpper: 0.15,
    strain: { local: pair([1, 0, 0], [3, 0, 0]), global: pair([1, 0, 0], [3, 0, 0]) },
    stress: { local: pair([10, 2, 0], [30, 4, 0]), global: pair([10, 2, 0], [30, 4, 0]) },
    rf: { lower: rf(2), upper: rf(1.5) },
    criterion: { lower: "puck", upper: "puck" },
  },
  {
    number: 2,
    angle: 90,
    materialId: "m",
    zLower: -0.15,
    zUpper: -0.05,
    strain: { local: pair([0, 0, 0], [1, 0, 0]), global: pair([0, 0, 0], [1, 0, 0]) },
    stress: { local: pair([-5, 0, 0], [-1, 0, 0]), global: pair([-5, 0, 0], [-1, 0, 0]) },
    rf: { lower: rf(0.8), upper: rf(Infinity) },
    criterion: { lower: "hashin", upper: "hashin" },
  },
];

describe("Arbeitsblatt durch die Dicke", () => {
  it("bildet z maßstäblich oder je Lage gleich hoch ab, und zurück", () => {
    const byZ = verticalScale(plies, "z", 300);
    expect(byZ.y(0.15)).toBe(0);
    expect(byZ.y(-0.15)).toBeCloseTo(300, 12);
    expect(byZ.y(-0.05)).toBeCloseTo(200, 12);
    expect(byZ.z(200)).toBeCloseTo(-0.05, 12);

    const byPly = verticalScale(plies, "ply", 300);
    // Equal bands: the interface sits halfway down.
    expect(byPly.y(-0.05)).toBeCloseTo(150, 12);
    expect(byPly.y(0.05)).toBeCloseTo(75, 12);
    expect(byPly.z(225)).toBeCloseTo(-0.1, 12);
    expect(byPly.bands.map((b) => b.ply.number)).toEqual([1, 2]);
  });

  it("liest Werte auf der Geraden zwischen den beiden Seiten der Lage", () => {
    expect(plyAt(plies, 0.05)?.number).toBe(1);
    expect(plyAt(plies, -0.05)?.number).toBe(1);
    expect(plyAt(plies, -0.1)?.number).toBe(2);
    expect(plyAt(plies, 0.2)).toBeNull();
    // The core's own numbers at the surfaces, the line between them inside.
    expect(valueAt(plies[0], "stress", "local", 0, 0.15)).toBe(30);
    expect(valueAt(plies[0], "stress", "local", 0, -0.05)).toBe(10);
    expect(valueAt(plies[0], "stress", "local", 0, 0.05)).toBeCloseTo(20, 12);
    expect(valueAt(plies[1], "strain", "global", 0, -0.1)).toBeCloseTo(0.5, 12);
  });

  it("umfasst null, die Grenze und die Werte, aber keine Ausreißer ohne Ende", () => {
    expect(valueRange(plies, "stress", "local", 0)).toEqual([-5, 30]);
    expect(valueRange(plies, "stress", "local", 2)).toEqual([-1, 1]);
    const [lo, hi] = metricRange(plies, "rf");
    expect(lo).toBe(0);
    expect(hi).toBeCloseTo(2 * 1.05, 12);
    // MoS goes below zero for the failing ply.
    expect(metricRange(plies, "mos")[0]).toBeCloseTo(-0.2, 12);
  });
});
