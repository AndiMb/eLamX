import { describe, expect, it } from "vitest";
import {
  expandLayup,
  expandedStack,
  formatLayup,
  normalizeLayerAngle,
  parseAngleStack,
  parseLayup,
  shortStackNotation,
  type Layup,
  type LayupError,
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
    expect(shortStackNotation([0, 45, 30, 90], false, false)).toBe("[0/45/30/90]");
    expect(shortStackNotation([0, 45, 30, 90], true, false)).toBe("[0/45/30/90]s");
  });

  it("writes a ply and its negative as a ± pair", () => {
    expect(shortStackNotation([0, 45, -45, 90], false, false)).toBe("[0/±45/90]");
    expect(shortStackNotation([0, -45, 45], true, false)).toBe("[0/∓45]s");
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

const BAR = String.fromCharCode(0x304);
const layup = (angles: number[], symmetric = false, withMiddleLayer = false): Layup => ({
  angles,
  symmetric,
  withMiddleLayer,
});

describe("parseLayup", () => {
  // The notation as people write it, and what it means. Each row is one
  // case; the table is the specification.
  const cases: [string, Layup][] = [
    ["0", layup([0])],
    [" 30 ", layup([30])],
    ["0/90/0", layup([0, 90, 0])],
    ["0/45/-45/90", layup([0, 45, -45, 90])],
    ["22,5/-22.5", layup([22.5, -22.5])],
    ["+45/-45", layup([45, -45])],
    ["±45", layup([45, -45])],
    ["+-45", layup([45, -45])],
    ["∓45", layup([-45, 45])],
    ["-+30", layup([-30, 30])],
    ["[0/45/-45/90]s", layup([0, 45, -45, 90], true)],
    ["[0/±45/90]s", layup([0, 45, -45, 90], true)],
    ["[0/±45/90]S", layup([0, 45, -45, 90], true)],
    ["[0/±45/90]se", layup([0, 45, -45, 90], true)],
    ["[0/±45/90]2s", layup([0, 45, -45, 90, 0, 45, -45, 90], true)],
    ["[0/±45/90]₂s", layup([0, 45, -45, 90, 0, 45, -45, 90], true)],
    ["[0/90]3", layup([0, 90, 0, 90, 0, 90])],
    ["[0_2/90]", layup([0, 0, 90])],
    ["[0₂/90]s", layup([0, 0, 90], true)],
    ["[(0/90)3/±45]s", layup([0, 90, 0, 90, 0, 90, 45, -45], true)],
    ["(0/90)_2", layup([0, 90, 0, 90])],
    ["±45₂", layup([45, -45, 45, -45])],
    ["(±45)₂", layup([45, -45, 45, -45])],
    [`[0/90/0${BAR}]s`, layup([0, 90, 0], true, true)],
    [`[0/90/0]s${BAR}`, layup([0, 90, 0], true, true)],
    ["[0/90/0]sT", layup([0, 90, 0], true, true)],
    ["[ 0 / 90 ] s", layup([0, 90], true)],
    ["[((0/90)2/45)2]", layup([0, 90, 0, 90, 45, 0, 90, 0, 90, 45])],
  ];

  it.each(cases)("reads %s", (text, expected) => {
    expect(parseLayup(text)).toEqual({ ok: true, layup: expected });
  });

  // And what it does not accept, with the reason and where it stopped.
  const errors: [string, LayupError, number][] = [
    ["", "empty", 0],
    ["0//90", "angle", 2],
    ["0/x", "angle", 2],
    ["[0/90", "unclosed", 0],
    ["(0/90", "unclosed", 0],
    ["[0/90]s x", "unexpected", 8],
    ["0/90]", "unexpected", 4],
    [`0/90${BAR}`, "middle", 4],
    [`[0${BAR}/90]s`, "middle", 2],
    [`[±45${BAR}]s`, "middle", 4],
    [`[0/90${BAR}]2s`, "middle", 5],
    ["[0/90]0", "count", 6],
    ["0_", "count", 2],
  ];

  it.each(errors)("rejects %j as %s at %i", (text, error, at) => {
    expect(parseLayup(text)).toEqual({ ok: false, error, at });
  });

  it("writes the mirrored half out when asked to expand", () => {
    expect(expandLayup(layup([0, 45, 90], true))).toEqual([0, 45, 90, 90, 45, 0]);
    expect(expandLayup(layup([0, 45, 90], true, true))).toEqual([0, 45, 90, 45, 0]);
    expect(parseAngleStack("[0/±45]s")).toEqual([0, 45, -45, -45, 45, 0]);
  });
});

describe("formatLayup", () => {
  const cases: [Layup, string][] = [
    [layup([0, 45, -45, 90], true), "[0/±45/90]s"],
    [layup([0, 45, -45, 90, 0, 45, -45, 90], true), "[0/±45/90]2s"],
    [layup([0, 90, 0, 90, 0, 90]), "[0/90]3"],
    [layup([45, -45, 45, -45]), "[±45]2"],
    [layup([45, -45, 45, -45, 0]), "[(±45)₂/0]"],
    [layup([45, 45, -45, -45]), "[45₂/-45₂]"],
    [layup([0, 0, 0, 0]), "[0₄]"],
    [layup([90, -90]), "[90/-90]"],
    [layup([0, 90, 0], true, true), `[0/90/0${BAR}]s`],
    [layup([22.5, -22.5, 0]), "[±22.5/0]"],
  ];

  it.each(cases)("writes %j as %s", (value, text) => {
    expect(formatLayup(value)).toBe(text);
  });

  /// Whatever the formatter writes, the parser reads back as the same stack -
  /// the property that lets a report's notation be pasted back in.
  it("reads back what it writes, for many stacks", () => {
    const choices = [0, 90, -90, 45, -45, 30, -30, 60, 22.5, -22.5, 15];
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let n = 0; n < 500; n++) {
      const length = 1 + Math.floor(random() * 12);
      const angles = Array.from({ length }, () => choices[Math.floor(random() * choices.length)]);
      const symmetric = random() < 0.5;
      const value = layup(angles, symmetric, symmetric && random() < 0.3);
      const text = formatLayup(value);
      expect(parseLayup(text), text).toEqual({ ok: true, layup: value });
    }
  });
});
