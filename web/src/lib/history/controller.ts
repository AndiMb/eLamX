// The undo history, connected to the store.
//
// One subscriber watches the whole project (`projectSnapshotV2Atom`) and
// records every change it sees; undo and redo put a recorded snapshot back
// through `restoreProjectAtom`, which sets only what differs. No editor has
// to call anything for its edits to be undoable - they are, because they
// change the project. What an editor MAY do is say where a step ends
// (`checkpointHistory`, e.g. when a field is left) or what a step is called
// (`historyStep`, for an action with a better name than the one the diff
// would give it).

import { atom, getDefaultStore } from "jotai";
import equal from "fast-deep-equal";
import {
  projectGenerationAtom,
  projectSnapshotV2Atom,
  restoreProjectAtom,
  type ProjectSnapshotV2,
} from "../../store/projectAtoms";
import { isTextField } from "../commands/shortcuts";
import { describeChange } from "./changePath";
import {
  COALESCE_MS,
  checkpoint,
  initialHistory,
  record,
  redo,
  undo,
  type HistoryState,
} from "./history";

type Store = ReturnType<typeof getDefaultStore>;

export type ProjectHistory = HistoryState<ProjectSnapshotV2>;

/** The history, for whatever shows it. Null until `installHistory` ran.
 *  Not persisted: a reload starts a new session, and undoing into the
 *  previous one would be undoing something the user no longer sees. */
export const historyAtom = atom<ProjectHistory | null>(null);

export interface HistoryOptions {
  now?: () => number;
  /** Whether a text field has the focus - typing into one is one step for
   *  as long as it keeps the focus. */
  fieldActive?: () => boolean;
}

interface Controller {
  store: Store;
  restoring: boolean;
  /** The label for the step being recorded, set by `historyStep`. */
  label: string | null;
  /** Distinguishes the steps of successive `historyStep` calls, which must
   *  not merge with each other even when they name the same thing. */
  sequence: number;
  now: () => number;
  fieldActive: () => boolean;
}

let active: Controller | null = null;

function defaultFieldActive(): boolean {
  return typeof document !== "undefined" && isTextField(document.activeElement as HTMLElement | null);
}

/**
 * Starts recording. Returns the function that stops it. One history per
 * app: a second install replaces the first.
 */
export function installHistory(store: Store = getDefaultStore(), options: HistoryOptions = {}): () => void {
  const controller: Controller = {
    store,
    restoring: false,
    label: null,
    sequence: 0,
    now: options.now ?? (() => Date.now()),
    fieldActive: options.fieldActive ?? defaultFieldActive,
  };
  active = controller;

  const reset = () =>
    store.set(historyAtom, initialHistory(store.get(projectSnapshotV2Atom), controller.now()));

  const onChange = () => {
    if (controller.restoring) return;
    const state = store.get(historyAtom);
    if (!state) return;
    const next = store.get(projectSnapshotV2Atom);
    const previous = state.present.snapshot;
    // Mounting a storage atom re-reads it, which hands out a new object with
    // the same content; that is not an edit.
    if (next === previous || equal(next, previous)) return;
    const change = describeChange(previous, next);
    const labelled = controller.label !== null;
    store.set(
      historyAtom,
      record(state, next, {
        label: controller.label ?? change.label,
        path: labelled ? `step:${controller.sequence}` : change.path,
        now: controller.now(),
        windowMs: labelled || controller.fieldActive() ? Infinity : COALESCE_MS,
      }),
    );
  };

  reset();
  const stopProject = store.sub(projectSnapshotV2Atom, onChange);
  // A new document starts a new history - after its content is in, so the
  // starting point is the document and not what was open before.
  const stopGeneration = store.sub(projectGenerationAtom, reset);
  return () => {
    stopProject();
    stopGeneration();
    if (active === controller) active = null;
  };
}

/** Ends the step being recorded; the next change starts a new one. */
export function checkpointHistory() {
  if (!active) return;
  const state = active.store.get(historyAtom);
  if (state) active.store.set(historyAtom, checkpoint(state));
}

/**
 * Runs `action` as one step called `label`, however many atoms it writes.
 * For actions whose own name says more than the diff would - "Lagen
 * verschoben" rather than "Lagen geändert".
 */
export function historyStep<T>(label: string, action: () => T): T {
  const controller = active;
  if (!controller) return action();
  checkpointHistory();
  controller.label = label;
  controller.sequence += 1;
  try {
    return action();
  } finally {
    controller.label = null;
    checkpointHistory();
  }
}

function travel(direction: typeof undo): boolean {
  const controller = active;
  if (!controller) return false;
  const { store } = controller;
  const state = store.get(historyAtom);
  if (!state) return false;
  const next = direction(state);
  if (next === state) return false;
  controller.restoring = true;
  try {
    store.set(restoreProjectAtom, next.present.snapshot);
  } finally {
    controller.restoring = false;
  }
  store.set(historyAtom, next);
  return true;
}

/** Takes back the last step. False if there was nothing to take back. */
export function undoProject(): boolean {
  return travel(undo);
}

/** Brings back the step the last undo took back. */
export function redoProject(): boolean {
  return travel(redo);
}
