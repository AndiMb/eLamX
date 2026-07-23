import { atomWithStorage } from "jotai/utils";

// Default open/closed state for every <HowWasThisComputed> panel: expanded
// for lecture demos / learning CLT, collapsed for quick productive checks.
// Persisted so a returning user doesn't have to re-toggle every session.
export const studentModeAtom = atomWithStorage<boolean>("elamx.studentMode", false);

// "system" follows prefers-color-scheme; an explicit choice stamps
// data-theme on <html> (see useApplyTheme), which index.css lets win over
// the media query in both directions.
export type ThemeChoice = "system" | "light" | "dark";
export const themeAtom = atomWithStorage<ThemeChoice>("elamx.theme", "system");
