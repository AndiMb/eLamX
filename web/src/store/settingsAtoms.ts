import { atomWithStorage } from "jotai/utils";
import type { FailureMetric } from "../lib/failureMetric";

// Default open/closed state for every <HowWasThisComputed> panel: expanded
// for lecture demos / learning CLT, collapsed for quick productive checks.
// Persisted so a returning user doesn't have to re-toggle every session.
export const studentModeAtom = atomWithStorage<boolean>("elamx.studentMode", false);

// "system" follows prefers-color-scheme; an explicit choice stamps
// data-theme on <html> (see useApplyTheme), which index.css lets win over
// the media query in both directions.
export type ThemeChoice = "system" | "light" | "dark";
export const themeAtom = atomWithStorage<ThemeChoice>("elamx.theme", "system");

// How reserve factors are shown: RF, IRF = 1/RF or MoS = RF - 1 (F2.2). A
// display setting like the theme - it changes numbers on screen and in
// exports, never what governs.
export const failureMetricAtom = atomWithStorage<FailureMetric>("elamx.failureMetric", "rf");

// The ply table with one value per ply (its governing surface) instead of
// both surfaces side by side.
export const layerResultsMinOnlyAtom = atomWithStorage<boolean>("elamx.layerResults.minOnly", false);

// How a table leaves the app - copied, or saved as CSV (F3.1). Full precision
// by default, so a value read back is the value computed; "as displayed" for
// a reviewer who wants the numbers of the report (O5). Separator and decimal
// mark follow the language unless set here.
export interface TableExportSettings {
  precision: "full" | "display";
  separator: "auto" | ";" | "," | "tab";
  decimal: "auto" | "," | ".";
}
export const tableExportSettingsAtom = atomWithStorage<TableExportSettings>("elamx.tableExport", {
  precision: "full",
  separator: "auto",
  decimal: "auto",
});
