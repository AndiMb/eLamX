// JS-side mirror of the --viz-* custom properties in App.css. Duplicated
// (rather than read via getComputedStyle) because the heatmap needs to
// arithmetically interpolate between colors - CSS custom properties can't be
// lerped in JS without first resolving them to concrete hex. Keep these in
// sync with App.css's `.viz` block by hand.
import { useAtomValue } from "jotai";
import { themeAtom } from "../store/settingsAtoms";

export interface ChartColors {
  diverging: { neg: string; mid: string; pos: string };
}

const light: ChartColors = {
  diverging: { neg: "#2a78d6", mid: "#f0efec", pos: "#e34948" },
};

const dark: ChartColors = {
  diverging: { neg: "#3987e5", mid: "#383835", pos: "#e66767" },
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
