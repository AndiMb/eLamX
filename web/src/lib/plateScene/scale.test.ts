import { describe, expect, it } from "vitest";
import {
  autoBounds,
  autoDeflectionScale,
  autoThicknessScale,
  peakOf,
} from "./scale";

describe("peakOf", () => {
  it("takes the largest magnitude, either sign", () => {
    expect(peakOf([[1, -4], [2, 3]])).toBe(4);
  });

  it("steps over holes rather than propagating them", () => {
    expect(peakOf([[1, NaN], [Infinity, -2]])).toBe(2);
  });
});

describe("autoDeflectionScale", () => {
  it("brings the peak to the requested fraction of the shorter edge", () => {
    const scale = autoDeflectionScale(2, 500, 300, 1 / 6);
    expect(2 * scale).toBeCloseTo(300 / 6, 12);
  });

  it("stays at 1 for a field that does not move", () => {
    expect(autoDeflectionScale(0, 500, 500)).toBe(1);
    expect(autoDeflectionScale(NaN, 500, 500)).toBe(1);
  });
});

describe("autoThicknessScale", () => {
  it("makes a thin laminate thick enough to see", () => {
    // 2 mm on a 500 mm plate would be four thousandths of the edge.
    expect(autoThicknessScale(2, 500, 500, 0.018)).toBeCloseTo(4.5, 12);
  });

  it("never draws a thick plate thinner than it is", () => {
    expect(autoThicknessScale(50, 500, 500, 0.018)).toBe(1);
  });
});

describe("autoBounds", () => {
  it("keeps a diverging scale symmetric, so neutral means zero", () => {
    expect(autoBounds([[-3, 1]], "diverging")).toEqual([-3, 3]);
    expect(autoBounds([[0.5, 2]], "diverging")).toEqual([-2, 2]);
  });

  it("gives a flat field a range rather than a point", () => {
    expect(autoBounds([[0, 0]], "diverging")).toEqual([-1, 1]);
    expect(autoBounds([[7, 7]], "sequential")).toEqual([7, 8]);
  });

  it("ignores holes", () => {
    expect(autoBounds([[NaN, -2, NaN]], "diverging")).toEqual([-2, 2]);
    expect(autoBounds([[NaN]], "diverging")).toEqual([-1, 1]);
  });
});
