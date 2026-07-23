import { atom } from "jotai";

// Which laminate nodes are expanded in the sidebar tree (showing their module
// children). Pure UI state - deliberately not persisted alongside domain data.
export const expandedLaminateIdsAtom = atom<Set<string>>(new Set<string>());
