import { describe, expect, it } from "vitest";
import {
  expandedStack,
  normalizeLayerAngle,
  parseAngleStack,
  shortStackNotation,
} from "./angleStack";

describe("normalizeLayerAngle", () => {
  it("reduces to the (-90, 90] representative a fibre direction actually has", () => {
    expect(normalizeLayerAngle(100)).toBe(-80);
    expect(normalizeLayerAngle(-100)).toBe(80);
    expect(normalizeLayerAngle(200)).toBe(20);
    expect(normalizeLayerAngle(270)).toBe(90);
  });

  it("leaves the canonical range alone, so it can be applied twice", () => {
    for (const angle of [-90, -45, 0, 22.5, 90]) {
      expect(normalizeLayerAngle(angle)).toBe(angle);
      expect(normalizeLayerAngle(normalizeLayerAngle(angle))).toBe(angle);
    }
  });
});

describe("parseAngleStack", () => {
  it("reads a whole stacking sequence, not just one number", () => {
    expect(parseAngleStack("0/45/-45/90")).toEqual([0, 45, -45, 90]);
    expect(parseAngleStack(" 30 ")).toEqual([30]);
  });

  it("accepts either decimal separator, like every other input", () => {
    expect(parseAngleStack("22,5/-22.5")).toEqual([22.5, -22.5]);
  });

  it("rejects anything incomplete rather than guessing", () => {
    expect(parseAngleStack("0//90")).toBeNull();
    expect(parseAngleStack("0/x")).toBeNull();
    expect(parseAngleStack("")).toBeNull();
  });
});

describe("shortStackNotation", () => {
  it("writes the stack the way it is written on a drawing", () => {
    expect(shortStackNotation([0, 45, -45, 90], false, false)).toBe("[0/45/-45/90]");
    expect(shortStackNotation([0, 45, -45, 90], true, false)).toBe("[0/45/-45/90]s");
  });

  it("collapses repeats into a subscripted count", () => {
    expect(shortStackNotation([0, 0, 45, 45, 45], false, false)).toBe("[0₂/45₃]");
    expect(shortStackNotation([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], false, false)).toBe("[0₁₂]");
  });

  it("puts the middle layer's overbar on the ANGLE, not after the bracket", () => {
    const notation = shortStackNotation([0, 45, 90], true, true);
    expect(notation).toBe("[0/45/90̄]s");
    expect(notation.endsWith("]s")).toBe(true);
  });

  it("survives an empty stack", () => {
    expect(shortStackNotation([], false, false)).toBe("[ ]");
  });
});

describe("expandedStack", () => {
  // Mirrors Laminate::number_of_layers / Laminate::thickness in the core; the
  // middle layer is the LAST stored ply and is counted once.
  it("counts a plain stack as it is", () => {
    expect(expandedStack([0.125, 0.25], false, false)).toEqual({ plies: 2, thickness: 0.375 });
  });

  it("mirrors a symmetric stack", () => {
    expect(expandedStack([0.125, 0.25], true, false)).toEqual({ plies: 4, thickness: 0.75 });
  });

  it("counts a shared middle layer once", () => {
    const { plies, thickness } = expandedStack([0.125, 0.25], true, true);
    expect(plies).toBe(3);
    expect(thickness).toBeCloseTo(0.5, 12);
  });

  it("has nothing to expand when there are no layers", () => {
    expect(expandedStack([], true, true)).toEqual({ plies: 0, thickness: 0 });
  });
});
