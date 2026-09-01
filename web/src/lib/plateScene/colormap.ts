// The colour scale as a 256-entry lookup table.
//
// Built from the same `chartColors` tokens the 2D charts use, so the 3D view is
// not a second palette. The table is what the surface shader samples and what
// the legend paints, which is the point: one mapping, two readers, no way for
// the legend to claim a colour the surface does not use.

import type { ChartColors } from "../chartColors";

export type ColormapKind = "diverging" | "sequential" | "reserve";

export const COLORMAP_STOPS = 256;

/**
 * RGBA bytes, `COLORMAP_STOPS` wide and one row high.
 *
 * `diverging` runs negative - neutral - positive, which is what a deflection or
 * a stress needs: the sign is meaningful and zero is a real neutral point.
 * `sequential` runs neutral - accent for quantities with no natural middle.
 * `reserve` runs danger - neutral - safe, for the reserve factor, whose
 * meaningful middle is 1.0 rather than 0 and whose two directions are not
 * "negative and positive" but "fails" and "holds". Borrowing the diverging
 * scale for it would put its neutral colour at zero - nowhere near the value
 * that decides anything - and colour a failing ply the same blue as a
 * deflection downwards.
 */
export function buildColormap(colors: ChartColors, kind: ColormapKind): Uint8Array {
  const neg = parseHex(colors.diverging.neg);
  const mid = parseHex(colors.diverging.mid);
  const pos = parseHex(colors.diverging.pos);
  const accent = parseHex(colors.surface);
  const danger = parseHex(colors.status.danger);
  const ok = parseHex(colors.status.ok);

  const table = new Uint8Array(COLORMAP_STOPS * 4);
  for (let i = 0; i < COLORMAP_STOPS; i++) {
    const t = i / (COLORMAP_STOPS - 1);
    const rgb =
      kind === "diverging"
        ? t < 0.5
          ? mix(neg, mid, t * 2)
          : mix(mid, pos, (t - 0.5) * 2)
        : kind === "reserve"
          ? t < 0.5
            ? mix(danger, mid, t * 2)
            : mix(mid, ok, (t - 0.5) * 2)
          : mix(mid, accent, t);
    table[i * 4] = rgb[0];
    table[i * 4 + 1] = rgb[1];
    table[i * 4 + 2] = rgb[2];
    table[i * 4 + 3] = 255;
  }
  return table;
}

/** The same lookup on the CPU, for the legend and for tests. */
export function sampleColormap(table: Uint8Array, t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  const index = Math.round(clamped * (COLORMAP_STOPS - 1)) * 4;
  return [table[index], table[index + 1], table[index + 2]];
}

/** A token colour in the 0..1 RGBA the scene styles are written in. */
export function rgbaOf(hex: string, alpha = 1): [number, number, number, number] {
  const [r, g, b] = parseHex(hex);
  return [r / 255, g / 255, b / 255, alpha];
}

function parseHex(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}
