import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

// Which laminate nodes are expanded in the sidebar tree (showing their module
// children). Pure UI state - deliberately not persisted alongside domain data.
export const expandedLaminateIdsAtom = atom<Set<string>>(new Set<string>());

/** What the stack drawing colours by. */
export type StackColorBy = "angle" | "material";

export interface StackVizOptions {
  colorBy: StackColorBy;
  showGlyphs: boolean;
  /** Draw the mirrored half of a symmetric laminate. */
  showMirror: boolean;
}

// How the stack is drawn is a preference about the drawing, not part of any
// project - so it is remembered across sessions, but outside the project and
// outside undo.
export const stackVizOptionsAtom = atomWithStorage<StackVizOptions>(
  "elamx.stackViz",
  { colorBy: "material", showGlyphs: true, showMirror: true },
  undefined,
  { getOnInit: true },
);
