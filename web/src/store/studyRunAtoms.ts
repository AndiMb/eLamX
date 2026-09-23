// Planning a study against the current project, and running it.
//
// Apart from studyAtoms.ts because it reads the whole project (through the
// undo snapshot), and the project module in turn holds the study definitions:
// in one module that would be an import cycle.

import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import type { PointResult } from "../lib/study/evaluate";
import { planStudy, type PlanMessages, type StudyPlan, type StudyProject } from "../lib/study/plan";
import { BatchCancelled, batchClient, type BatchHandle } from "../lib/batchClient";
import { projectSnapshotV2Atom, type ModuleInputs } from "./projectAtoms";
import { studiesAtom, studyResultsFamily } from "./studyAtoms";
import { localeAtom, t } from "../i18n";


/** The project as a study sees it - read from the undo snapshot, which reads
 *  every module input unconditionally and so notices an analysis being set
 *  up, not only one being edited. */
export const studyProjectAtom = atom<StudyProject>((get) => {
  const snapshot = get(projectSnapshotV2Atom);
  const pick = <K extends keyof ModuleInputs>(key: K) => {
    const out: Record<string, NonNullable<ModuleInputs[K]>> = {};
    for (const [id, modules] of Object.entries(snapshot.modules)) {
      const value = modules[key];
      if (value) out[id] = value as NonNullable<ModuleInputs[K]>;
    }
    return out;
  };
  return {
    laminates: snapshot.laminates,
    materials: snapshot.materials,
    bucklings: pick("buckling"),
    vibrations: pick("vibration"),
    deformations: pick("deformation"),
    lastPlyFailures: pick("lastPlyFailure"),
  };
});

export function planMessages(translate: typeof t = t): PlanMessages {
  return {
    lpfNeedsLoads: translate("study.invalid.lpfNeedsLoads"),
    fractionsExceedOne: translate("study.invalid.fractionsExceedOne"),
    fractionsUndetermined: translate("study.invalid.fractionsUndetermined"),
    noLayers: translate("study.invalid.noLayers"),
  };
}

/** A study's plan against the current project, or null for a study that no
 *  longer exists. */
export const studyPlanFamily = atomFamily((id: string) =>
  atom((get): StudyPlan | null => {
    const study = get(studiesAtom).find((s) => s.id === id);
    if (!study) return null;
    // The catalog is read so that a language switch rebuilds the gaps'
    // reasons; the points themselves do not depend on it.
    get(localeAtom);
    return planStudy(study, get(studyProjectAtom), planMessages());
  }),
);

/** Whether the shown results were computed from other inputs than the
 *  study's current ones. */
export const studyStaleFamily = atomFamily((id: string) =>
  atom((get) => {
    const run = get(studyResultsFamily(id));
    const plan = get(studyPlanFamily(id));
    return run !== null && plan !== null && run.hash !== plan.hash;
  }),
);

const running = new Map<string, BatchHandle>();

/** Computes a study on the batch worker, point by point into its results. */
export const runStudyAtom = atom(null, async (get, set, id: string) => {
  const plan = get(studyPlanFamily(id));
  if (!plan) return;
  running.get(id)?.cancel();
  const results = studyResultsFamily(id);
  const total = plan.points.length;
  const points: (PointResult | undefined)[] = new Array(total);
  set(results, { hash: plan.hash, status: "running", points, done: 0, total });
  const started = performance.now();
  // Points arrive faster than a render is worth; the atom is written at most
  // every animation frame's worth of time.
  let dirty = false;
  let lastFlush = 0;
  const flush = (force = false) => {
    const now = performance.now();
    if (!dirty || (!force && now - lastFlush < 50)) return;
    dirty = false;
    lastFlush = now;
    const current = get(results);
    if (current && current.hash === plan.hash) set(results, { ...current, points: [...points] });
  };
  const handle = batchClient.run(
    { kind: "points", points: plan.points },
    {
      onPoint: (index, value) => {
        points[index] = value;
        dirty = true;
        flush();
      },
      onProgress: (done) => {
        const current = get(results);
        if (current && current.status === "running") set(results, { ...current, done });
      },
    },
  );
  running.set(id, handle);
  try {
    await handle.promise;
    dirty = true;
    flush(true);
    set(results, { hash: plan.hash, status: "done", points: [...points], done: total, total, took: performance.now() - started });
  } catch (error) {
    const current = get(results);
    if (error instanceof BatchCancelled) {
      if (running.get(id) === handle && current) set(results, { ...current, points: [...points], status: "cancelled" });
    } else {
      set(results, { hash: plan.hash, status: "failed", points: [...points], done: current?.done ?? 0, total, error: String(error) });
    }
  } finally {
    if (running.get(id) === handle) running.delete(id);
  }
});

export const cancelStudyAtom = atom(null, (_get, _set, id: string) => {
  running.get(id)?.cancel();
});
