import { describe, expect, it } from "vitest";
import { buildColormap, COLORMAP_STOPS, sampleColormap } from "./colormap";
import type { ChartColors } from "../chartColors";

const colors: ChartColors = {
  diverging: { neg: "#2a78d6", mid: "#f0efec", pos: "#e34948" },
  surface: "#2a78d6",
  status: { ok: "#1baf7a", danger: "#e34948" },
  annotation: { support: "#48505f", load: "#eb6834" },
};

describe("buildColormap", () => {
  it("fills a full RGBA row", () => {
    const table = buildColormap(colors, "diverging");
    expect(table.length).toBe(COLORMAP_STOPS * 4);
    for (let i = 3; i < table.length; i += 4) expect(table[i]).toBe(255);
  });

  it("puts the token colours at the ends and the neutral in the middle", () => {
    const table = buildColormap(colors, "diverging");
    expect(sampleColormap(table, 0)).toEqual([0x2a, 0x78, 0xd6]);
    expect(sampleColormap(table, 1)).toEqual([0xe3, 0x49, 0x48]);
    // An even number of stops has no entry exactly at the middle - zero falls
    // between 127 and 128 - so the neutral is asserted to within a stop. The
    // shader samples the texture with linear filtering and does land on it.
    const middle = sampleColormap(table, 0.5);
    for (const [channel, expected] of [0xf0, 0xef, 0xec].entries()) {
      expect(Math.abs(middle[channel] - expected)).toBeLessThanOrEqual(2);
    }
  });

  it("has no seam: neighbouring stops differ by at most a step", () => {
    const table = buildColormap(colors, "diverging");
    for (let i = 1; i < COLORMAP_STOPS; i++) {
      for (let channel = 0; channel < 3; channel++) {
        const jump = Math.abs(table[i * 4 + channel] - table[(i - 1) * 4 + channel]);
        expect(jump).toBeLessThanOrEqual(3);
      }
    }
  });

  it("runs neutral to accent when it has no natural middle", () => {
    const table = buildColormap(colors, "sequential");
    expect(sampleColormap(table, 0)).toEqual([0xf0, 0xef, 0xec]);
    expect(sampleColormap(table, 1)).toEqual([0x2a, 0x78, 0xd6]);
  });

  it("clamps rather than reading past the table", () => {
    const table = buildColormap(colors, "diverging");
    expect(sampleColormap(table, -5)).toEqual(sampleColormap(table, 0));
    expect(sampleColormap(table, 5)).toEqual(sampleColormap(table, 1));
  });
});
