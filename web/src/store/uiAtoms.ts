import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { atomFamily } from "jotai-family";

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

/** Which plies of a laminate are selected in its table - what the bulk
 *  actions, the clipboard, Alt+↑/↓ and a drag of several rows act on.
 *  View state, not project: outside undo and not saved. May name plies that
 *  no longer exist (after an undo, say); readers intersect it with the
 *  current plies. */
export const layerSelectionFamily = atomFamily((_laminateId: string) => atom<ReadonlySet<string>>(new Set<string>()));

/** The z-coordinate under the pointer in a laminate's through-thickness
 *  sheet, shared by all its columns so the crosshair runs through every one.
 *  View state: not saved, not undone. */
export const hoverZFamily = atomFamily((_laminateId: string) => atom<number | null>(null));
