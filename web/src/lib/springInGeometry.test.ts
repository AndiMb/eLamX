import { describe, expect, it } from "vitest";
import { outlineBounds, springInOutline, springInOutlines } from "./springInGeometry";

const RADIUS = 10;
const THICKNESS = 1;
const FLANGE = RADIUS * 2;

const near = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

// The arc segment count, derived the way the original derives it: a fixed
// angular step of 90/20 degrees, then one more segment than fits. Repeated
// here rather than exported, so a change to the step has to be made twice on
// purpose.
const segmentsFor = (angle: number) =>
  Math.floor((angle * Math.PI) / 180 / (Math.PI / 2 / 20)) + 1;

describe("springInOutline", () => {
  it("closes on itself, which is what makes it drawable as one stroke", () => {
    const outline = springInOutline({ angle: 90, radius: RADIUS, thickness: THICKNESS });
    expect(outline[0]).toEqual([0, 0]);
    expect(outline[outline.length - 1]).toEqual([0, 0]);
    // 7 fixed points plus two arcs of `segments` each: eLamX's own count.
    expect(outline).toHaveLength(7 + 2 * segmentsFor(90));
  });

  it("starts as a flange of constant thickness along the y axis", () => {
    const outline = springInOutline({ angle: 90, radius: RADIUS, thickness: THICKNESS });
    // Outer face at x = 0, inner face at x = thickness, both from the free end
    // to the start of the bend.
    expect(outline[0]).toEqual([0, 0]);
    expect(outline[1]).toEqual([0, FLANGE]);
    expect(outline[outline.length - 2]).toEqual([THICKNESS, 0]);
    const innerArcStart = outline[outline.length - 3];
    near(innerArcStart[0], THICKNESS);
    near(innerArcStart[1], FLANGE);
  });

  it("bends about one centre, so the wall keeps its thickness all the way round", () => {
    const outline = springInOutline({ angle: 90, radius: RADIUS, thickness: THICKNESS });
    const centre = [RADIUS + THICKNESS / 2, FLANGE];
    const radiusAt = (p: [number, number]) => Math.hypot(p[0] - centre[0], p[1] - centre[1]);
    const segments = segmentsFor(90);
    // The outer arc runs from index 2, the inner one back from the closing pair.
    for (let i = 2; i <= 1 + segments; i++) near(radiusAt(outline[i]), RADIUS + THICKNESS / 2);
    for (let i = 4 + segments; i <= 4 + 2 * segments; i++) {
      near(radiusAt(outline[i]), RADIUS - THICKNESS / 2);
    }
  });

  it("turns the second flange by exactly the angle given", () => {
    // A right angle puts the far flange along +x, with its outer face further
    // from the origin - the L everyone pictures.
    const outline = springInOutline({ angle: 90, radius: RADIUS, thickness: THICKNESS });
    const outerEnd = outline[2 + segmentsFor(90)];
    const innerEnd = outline[3 + segmentsFor(90)];
    near(outerEnd[0], FLANGE + RADIUS + THICKNESS / 2);
    near(outerEnd[1], FLANGE + RADIUS + THICKNESS / 2);
    near(innerEnd[0], FLANGE + RADIUS + THICKNESS / 2);
    near(innerEnd[1], FLANGE + RADIUS - THICKNESS / 2);
    // And the two ends are one thickness apart, whatever the angle.
    for (const angle of [30, 90, 135, 180]) {
      const o = springInOutline({ angle, radius: RADIUS, thickness: THICKNESS });
      const a = o[2 + segmentsFor(angle)];
      const b = o[3 + segmentsFor(angle)];
      near(Math.hypot(a[0] - b[0], a[1] - b[1]), THICKNESS);
    }
  });

  it("uses more arc segments for a longer bend rather than stretching the same ones", () => {
    const at = (angle: number) =>
      springInOutline({ angle, radius: RADIUS, thickness: THICKNESS }).length;
    expect(at(180)).toBeGreaterThan(at(90));
    expect(at(90)).toBeGreaterThan(at(45));
    // Even a bend of nothing draws something closed rather than an empty list.
    expect(at(0)).toBe(7 + 2);
  });

  it("gives a straight strip when there is no bend at all", () => {
    const outline = springInOutline({ angle: 0, radius: RADIUS, thickness: THICKNESS });
    const { minX, maxX } = outlineBounds([outline]);
    near(minX, 0);
    near(maxX, THICKNESS);
  });
});

describe("springInOutlines", () => {
  it("draws the part at the tool angle plus the spring-in", () => {
    const input = { angle: 90, radius: RADIUS, thickness: THICKNESS };
    const { tool, part } = springInOutlines(input, 0.4);
    expect(tool).toEqual(springInOutline(input));
    expect(part).toEqual(springInOutline({ ...input, angle: 90.4 }));
    // A closed corner reaches further round: the far flange's outer tip sits
    // lower in y than the tool's does. That is the whole picture in one number.
    const tip = 2 + segmentsFor(90);
    expect(part[tip][1]).toBeLessThan(tool[tip][1]);
  });

  it("puts the two outlines on top of each other when nothing happens", () => {
    const input = { angle: 90, radius: RADIUS, thickness: THICKNESS };
    const { tool, part } = springInOutlines(input, 0);
    expect(part).toEqual(tool);
  });
});

describe("outlineBounds", () => {
  it("spans every outline it is given", () => {
    const input = { angle: 90, radius: RADIUS, thickness: THICKNESS };
    const { tool, part } = springInOutlines(input, 5);
    const both = outlineBounds([tool, part]);
    const justTool = outlineBounds([tool]);
    expect(both.minX).toBeLessThanOrEqual(justTool.minX);
    expect(both.maxY).toBeGreaterThanOrEqual(justTool.maxY);
  });
});
