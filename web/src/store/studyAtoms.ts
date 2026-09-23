// Studies: their definitions, which are the project's, and their results,
// which are this session's.
//
// The definitions persist like every other part of the project - in browser
// storage, in the file's `<webExtension>`, in the undo history. The results
// live only in memory, one entry per study, next to the fingerprint of the
// inputs they were computed from: when the project changes so that the
// study's inputs change, the fingerprint no longer matches and the results
// are shown as outdated, to be recomputed on request rather than behind the
// user's back (a sweep can take minutes).

import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import type { PointResult } from "../lib/study/evaluate";
import { defaultMatrix, defaultSweep, type StudyDef } from "../lib/study/model";
import { t } from "../i18n";

export const STUDIES_STORAGE_KEY = "elamx.studies";

export const studiesAtom = atomWithStorage<StudyDef[]>(
  STUDIES_STORAGE_KEY,
  [],
  createJSONStorage<StudyDef[]>(() => localStorage),
  { getOnInit: true },
);

/** A study's last run. */
export interface StudyRun {
  /** Fingerprint of the points it computed - see `StudyPlan.hash`. */
  hash: string;
  status: "running" | "done" | "cancelled" | "failed";
  /** By point index; a hole is a point not computed yet. */
  points: (PointResult | undefined)[];
  done: number;
  total: number;
  error?: string;
  /** Wall-clock milliseconds, once finished. */
  took?: number;
}

export const studyResultsFamily = atomFamily((_id: string) => atom<StudyRun | null>(null));

/** Adds a study of the given kind and returns its id. */
export const addStudyAtom = atom(null, (get, set, { kind, laminateId }: { kind: "matrix" | "sweep"; laminateId: string }) => {
  const studies = get(studiesAtom);
  const id = crypto.randomUUID();
  const nr = studies.filter((s) => s.kind === kind).length + 1;
  const study: StudyDef =
    kind === "matrix"
      ? { id, name: t("study.defaultName.matrix", { nr }), kind, matrix: defaultMatrix() }
      : { id, name: t("study.defaultName.sweep", { nr }), kind, sweep: defaultSweep(laminateId) };
  set(studiesAtom, [...studies, study]);
  return id;
});

export const updateStudyAtom = atom(null, (get, set, study: StudyDef) => {
  set(
    studiesAtom,
    get(studiesAtom).map((s) => (s.id === study.id ? study : s)),
  );
});

export const removeStudyAtom = atom(null, (get, set, id: string) => {
  set(
    studiesAtom,
    get(studiesAtom).filter((s) => s.id !== id),
  );
  studyResultsFamily.remove(id);
});
