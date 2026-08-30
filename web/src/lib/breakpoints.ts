// The four widths at which this app changes shape, in one place.
//
// They were in two: `(max-width: 640px)` as a string in useIsMobile and six
// more times in App.css, `(max-width: 900px)` in MobileCollapse and three
// times in App.css. A media query cannot read a custom property, so CSS
// cannot import these - what keeps the two honest is breakpoints.test.ts,
// which reads the stylesheets and fails if a media query uses a width that is
// not one of these, or if one of these stops appearing.
//
// Four thresholds rather than one, because they answer different questions.
// The shell switches where the TREE stops fitting; the content switches, much
// later, where a heatmap stops fitting beside a sweep.

export interface Breakpoint {
  /** The media condition, exactly as the stylesheets spell it. */
  readonly condition: string;
  /** What changes at it. */
  readonly reason: string;
}

export const BREAKPOINTS = {
  /** Below this the laminate tree becomes a bottom tab bar, and record
   *  tables become cards. */
  mobile: {
    condition: "(max-width: 640px)",
    reason: "the sidebar tree no longer fits",
  },
  /** Below this a panel that is heavy or grows with the stack goes behind a
   *  tap - see MobileCollapse. Wider than `mobile` on purpose: a portrait
   *  tablet gets the desktop shell and still has the phone's scrolling
   *  problem. */
  narrow: {
    condition: "(max-width: 900px)",
    reason: "content stops fitting side by side",
  },
  /** From here a module's input column stands beside its results and stays
   *  put while they scroll - see .module-split. */
  split: {
    condition: "(min-width: 1024px)",
    reason: "input and results fit side by side",
  },
  /** Below this the CLT equation stacks. It needs about 970 px of panel for
   *  its four blocks; measured, the side-by-side layout first fits between
   *  1224 and 1256 px. */
  equation: {
    condition: "(max-width: 1279px)",
    reason: "the equation's four blocks do not fit in a row",
  },
} as const satisfies Record<string, Breakpoint>;

/** Conditions that are not widths at all, and so are not breakpoints. */
export const NON_WIDTH_CONDITIONS = [
  "(prefers-color-scheme: dark)",
  "(prefers-reduced-motion: reduce)",
] as const;

export const MOBILE_QUERY = BREAKPOINTS.mobile.condition;
export const NARROW_QUERY = BREAKPOINTS.narrow.condition;
