// JS-side mirror of the --viz-* custom properties in App.css. Duplicated
// (rather than read via getComputedStyle) because the heatmap needs to
// arithmetically interpolate between colors - CSS custom properties can't be
// lerped in JS without first resolving them to concrete hex. Keep these in
// sync with App.css's `.viz` block by hand.
import { useAtomValue } from "jotai";
import { themeAtom } from "../store/settingsAtoms";

export interface ChartColors {
  diverging: { neg: string; mid: string; pos: string };
  /** Base hue of a shaded 3D body (--viz-series-1). */
  surface: string;
  /** Pass/fail marks - the same two roles the chips use. */
  status: { ok: string; danger: string };
  /**
   * Annotation that is not a result: how the plate is held, and what pushes
   * it. Deliberately outside the diverging scale, so a load arrow can never be
   * mistaken for a value on the body it stands next to.
   */
  annotation: { support: string; load: string };
}

const light: ChartColors = {
  diverging: { neg: "#2a78d6", mid: "#f0efec", pos: "#e34948" },
  surface: "#2a78d6",
  status: { ok: "#1baf7a", danger: "#e34948" },
  annotation: { support: "#48505f", load: "#eb6834" },
};

const dark: ChartColors = {
  diverging: { neg: "#3987e5", mid: "#383835", pos: "#e66767" },
  surface: "#3987e5",
  status: { ok: "#199e70", danger: "#e66767" },
  annotation: { support: "#b3bdcb", load: "#d95926" },
};

// Must consider BOTH dark-mode paths: the explicit theme toggle (themeAtom /
// data-theme attribute) and, when that is "system", the OS preference - the
// same resolution order the CSS token scopes in index.css implement.
export function useChartColors(): ChartColors {
  const theme = useAtomValue(themeAtom);
  const systemPrefersDark =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = theme === "dark" || (theme === "system" && systemPrefersDark);
  return isDark ? dark : light;
}
