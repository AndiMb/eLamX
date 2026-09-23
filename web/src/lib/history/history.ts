// The undo history as plain data and pure functions over it.
//
// A stack of whole-project snapshots rather than a list of inverse commands:
// the project is spread over some fifteen atom families, and every one of
// them would need its own inverse for every kind of edit. A snapshot needs
// none, and it is cheap - the unchanged parts of two snapshots are the same
// objects, because they come straight out of atoms that were not written.
//
// Nothing here knows about jotai or the DOM; controller.ts connects it to the
// store. That keeps the rules - when two edits are one step, what a new edit
// does to the redo stack - testable with a clock that is just a number.

/** The most steps kept. The requirement is 100; the rest is headroom for
 *  steps too small to notice, such as a checkbox. */
export const HISTORY_LIMIT = 200;

/** Edits to the same thing closer together than this are one step - a burst
 *  of arrow-key presses on a select, or a slider being dragged. */
export const COALESCE_MS = 600;

export interface HistoryEntry<S> {
  snapshot: S;
  /** What the change that led to this state was, for the undo tooltip. */
  label: string;
  /** What it changed, as a key: edits with the same path may merge. */
  path: string;
  /** When it was last changed. */
  at: number;
}

export interface HistoryState<S> {
  past: HistoryEntry<S>[];
  present: HistoryEntry<S>;
  future: HistoryEntry<S>[];
  /** Whether `present` may still absorb a further edit to the same path.
   *  A checkpoint, an undo and a redo all close it. */
  open: boolean;
}

export function initialHistory<S>(snapshot: S, now: number): HistoryState<S> {
  return { past: [], present: { snapshot, label: "", path: "", at: now }, future: [], open: false };
}

export interface RecordOptions {
  label: string;
  path: string;
  now: number;
  /** Merge with the open step for this long after its last edit. A text
   *  field that has the focus passes Infinity: typing is one step until the
   *  field is left or confirmed, however long the pauses between keys. */
  windowMs?: number;
}

/**
 * Adds a change. It either becomes the new present, pushing the old one into
 * the past and dropping everything that could have been redone, or - when it
 * continues the open step on the same path - it replaces the present, which
 * then stands for both.
 */
export function record<S>(
  state: HistoryState<S>,
  snapshot: S,
  { label, path, now, windowMs = COALESCE_MS }: RecordOptions,
): HistoryState<S> {
  const { present } = state;
  if (state.open && present.path === path && now - present.at <= windowMs) {
    return { ...state, present: { ...present, snapshot, at: now }, future: [] };
  }
  const past = [...state.past, present];
  // The oldest steps go first; what is left can still all be undone.
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, present: { snapshot, label, path, at: now }, future: [], open: true };
}

/** Ends the open step, so the next change starts a new one. */
export function checkpoint<S>(state: HistoryState<S>): HistoryState<S> {
  return state.open ? { ...state, open: false } : state;
}

/** Steps back. The state to put back is the new `present.snapshot`. */
export function undo<S>(state: HistoryState<S>): HistoryState<S> {
  if (state.past.length === 0) return state;
  const past = state.past.slice(0, -1);
  const present = state.past[state.past.length - 1];
  return { past, present, future: [state.present, ...state.future], open: false };
}

/** Steps forward again, after an undo. */
export function redo<S>(state: HistoryState<S>): HistoryState<S> {
  if (state.future.length === 0) return state;
  const [present, ...future] = state.future;
  return { past: [...state.past, state.present], present, future, open: false };
}

/** The label of the step an undo would take back, or null if there is none. */
export function undoLabel<S>(state: HistoryState<S>): string | null {
  return state.past.length > 0 ? state.present.label : null;
}

/** The label of the step a redo would bring back, or null if there is none. */
export function redoLabel<S>(state: HistoryState<S>): string | null {
  return state.future.length > 0 ? state.future[0].label : null;
}
