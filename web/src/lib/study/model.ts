// Studies as the app keeps them, and as the file keeps them.
//
// A study is a project object (E8): its DEFINITION is saved with the project,
// in `<webExtension>`, and undone like any other edit. Its RESULTS are not -
// they are recomputed when the study is looked at, so a file cannot carry
// numbers that no longer follow from its inputs.
//
// The two shapes differ in one respect: the app names a load case by its id,
// which is regenerated on every open, and the file names it by laminate,
// position and name (`LoadCaseRef`), as the comparison does.

import type { CriterionId } from "../types";
import type { LaminateConfig } from "../../store/laminateAtoms";
import type { LoadCaseRef } from "../generated/LoadCaseRef";
import type { Study } from "../generated/Study";
import type { Variation } from "../generated/Variation";
import { STUDY_OUTPUTS, type StudyOutput } from "./evaluate";

/** A load case of one laminate of the project. */
export interface LoadCaseSel {
  laminateId: string;
  loadCaseId: string;
}

export type LoadComponent = "n_x" | "n_y" | "n_xy" | "m_x" | "m_y" | "m_xy" | "factor";
export const LOAD_COMPONENTS: LoadComponent[] = ["n_x", "n_y", "n_xy", "m_x", "m_y", "m_xy", "factor"];

export type VariationKind = "angle" | "fraction" | "load" | "plate" | "thickness";
export const VARIATION_KINDS: VariationKind[] = ["angle", "fraction", "load", "plate", "thickness"];

/** One varied input and its range. Only the fields of its `kind` apply; the
 *  others are kept so that switching kinds back and forth loses nothing. */
export interface VariationDef {
  kind: VariationKind;
  /** `angle`: layers set to the value. `thickness`: layers whose thickness
   *  is the value, empty for all. Layer ids. */
  layers: string[];
  /** `angle`: layers set to minus the value - the other half of +-theta. */
  negated: string[];
  family: "0" | "45" | "90";
  component: LoadComponent;
  dim: "a" | "b";
  from: number;
  to: number;
  /** Points over the range, both ends included. */
  steps: number;
}

export type MatrixColumns = "load_case" | "criterion";
export type MatrixOutput = "min_rf" | "lpf";

export interface MatrixDef {
  /** Laminate ids; empty for every laminate. */
  laminates: string[];
  columns: MatrixColumns;
  /** `load_case` columns: each applied to every laminate; empty for all of
   *  the laminates' own. `criterion` columns: at most one, the case every
   *  laminate is judged under; empty for each laminate's first. */
  loadCases: LoadCaseSel[];
  criteria: CriterionId[];
  output: MatrixOutput;
  transpose: boolean;
}

export interface SweepDef {
  laminateId: string;
  /** Null for the laminate's first load case. */
  loadCaseId: string | null;
  x: VariationDef;
  y: VariationDef | null;
  outputs: StudyOutput[];
  /** Plies of the generated laminate when a ply fraction is varied. */
  plies: number;
  /** Fractions of 0, +-45 and 90 degree plies the varied ones start from. */
  fractions: [number, number, number];
}

interface StudyBase {
  id: string;
  name: string;
}

export type StudyDef =
  | (StudyBase & { kind: "matrix"; matrix: MatrixDef })
  | (StudyBase & { kind: "sweep"; sweep: SweepDef })
  /** Written by a later version, in a shape this build cannot interpret.
   *  Shown as such and written back as it was read. */
  | (StudyBase & { kind: "unknown"; raw: Study });

export function defaultVariation(kind: VariationKind = "angle"): VariationDef {
  const base: VariationDef = {
    kind,
    layers: [],
    negated: [],
    family: "0",
    component: "n_x",
    dim: "a",
    from: 0,
    to: 90,
    steps: 19,
  };
  switch (kind) {
    case "angle":
      return base;
    case "fraction":
      return { ...base, from: 0, to: 1, steps: 11 };
    case "load":
      return { ...base, from: 0.5, to: 2, steps: 16, component: "factor" };
    case "plate":
      return { ...base, from: 250, to: 1000, steps: 16 };
    case "thickness":
      return { ...base, from: 0.1, to: 0.3, steps: 11 };
  }
}

export function defaultMatrix(): MatrixDef {
  return { laminates: [], columns: "load_case", loadCases: [], criteria: [], output: "min_rf", transpose: false };
}

export function defaultSweep(laminateId: string): SweepDef {
  return {
    laminateId,
    loadCaseId: null,
    x: defaultVariation("angle"),
    y: null,
    outputs: ["min_rf"],
    plies: 16,
    fractions: [0.5, 0.25, 0.25],
  };
}

// ---------------------------------------------------------------------------
// File mapping
// ---------------------------------------------------------------------------

function refOf(sel: LoadCaseSel, laminates: LaminateConfig[]): LoadCaseRef | null {
  const laminate = laminates.find((l) => l.id === sel.laminateId);
  const index = laminate?.loadCases.findIndex((c) => c.id === sel.loadCaseId) ?? -1;
  if (!laminate || index < 0) return null;
  return { laminate_uuid: laminate.id, load_case_index: index, load_case_name: laminate.loadCases[index].name };
}

/** A load case the file names, in this session - or null when the file no
 *  longer has it. Position first, then an unambiguous name, as for the
 *  comparison. */
function selOf(ref: LoadCaseRef, laminates: LaminateConfig[]): LoadCaseSel | null {
  const laminate = laminates.find((l) => l.id === ref.laminate_uuid);
  if (!laminate) return null;
  const atIndex = laminate.loadCases[ref.load_case_index];
  if (atIndex && atIndex.name === ref.load_case_name) return { laminateId: laminate.id, loadCaseId: atIndex.id };
  const byName = laminate.loadCases.filter((c) => c.name === ref.load_case_name);
  return byName.length === 1 ? { laminateId: laminate.id, loadCaseId: byName[0].id } : null;
}

function toFileVariation(v: VariationDef): Variation {
  return {
    kind: v.kind,
    layers: v.layers,
    negated: v.negated,
    family: v.family,
    component: v.component,
    dim: v.dim,
    from: v.from,
    to: v.to,
    steps: v.steps,
  };
}

function fromFileVariation(v: Variation): VariationDef | null {
  if (!(VARIATION_KINDS as string[]).includes(v.kind)) return null;
  const fallback = defaultVariation(v.kind as VariationKind);
  return {
    kind: v.kind as VariationKind,
    layers: v.layers,
    negated: v.negated,
    family: (["0", "45", "90"].includes(v.family) ? v.family : fallback.family) as VariationDef["family"],
    component: ((LOAD_COMPONENTS as string[]).includes(v.component) ? v.component : fallback.component) as LoadComponent,
    dim: v.dim === "b" ? "b" : "a",
    from: v.from,
    to: v.to,
    steps: Math.max(1, Math.round(v.steps)),
  };
}

/** A study as the file keeps it. */
export function toFileStudy(study: StudyDef, laminates: LaminateConfig[]): Study {
  switch (study.kind) {
    case "unknown":
      return study.raw;
    case "matrix": {
      const m = study.matrix;
      return {
        id: study.id,
        name: study.name,
        kind: "matrix",
        matrix: {
          laminates: m.laminates,
          columns: m.columns,
          load_cases: m.loadCases.map((s) => refOf(s, laminates)).filter((r): r is LoadCaseRef => r !== null),
          criteria: m.criteria,
          output: m.output,
          transpose: m.transpose,
        },
      };
    }
    case "sweep": {
      const s = study.sweep;
      return {
        id: study.id,
        name: study.name,
        kind: "sweep",
        sweep: {
          laminate_uuid: s.laminateId,
          load_case: s.loadCaseId ? refOf({ laminateId: s.laminateId, loadCaseId: s.loadCaseId }, laminates) : null,
          x: toFileVariation(s.x),
          y: s.y ? toFileVariation(s.y) : null,
          outputs: s.outputs,
          plies: s.plies,
          fractions: s.fractions,
        },
      };
    }
  }
}

/** A load case of the file's study that this file no longer has - the file
 *  was edited in eLamX 3.x. Reported, and the study goes on without it. */
export interface DroppedStudyRef {
  study: string;
  loadCase: string;
}

/** A study from the file, in this session. */
export function fromFileStudy(
  study: Study,
  laminates: LaminateConfig[],
  dropped: DroppedStudyRef[] = [],
): StudyDef {
  const base = { id: study.id || crypto.randomUUID(), name: study.name };
  const unknown = { ...base, kind: "unknown" as const, raw: study };
  const resolve = (ref: LoadCaseRef) => {
    const sel = selOf(ref, laminates);
    if (!sel) dropped.push({ study: study.name, loadCase: ref.load_case_name });
    return sel;
  };
  if (study.kind === "matrix" && study.matrix) {
    const m = study.matrix;
    if (!["load_case", "criterion"].includes(m.columns) || !["min_rf", "lpf"].includes(m.output)) return unknown;
    return {
      ...base,
      kind: "matrix",
      matrix: {
        laminates: m.laminates,
        columns: m.columns as MatrixColumns,
        loadCases: m.load_cases.map(resolve).filter((s): s is LoadCaseSel => s !== null),
        criteria: m.criteria as CriterionId[],
        output: m.output as MatrixOutput,
        transpose: m.transpose,
      },
    };
  }
  if (study.kind === "sweep" && study.sweep) {
    const s = study.sweep;
    const x = fromFileVariation(s.x);
    const y = s.y ? fromFileVariation(s.y) : null;
    const outputs = s.outputs.filter((o): o is StudyOutput => (STUDY_OUTPUTS as readonly string[]).includes(o));
    if (!x || (s.y && !y) || outputs.length !== s.outputs.length) return unknown;
    const loadCase = s.load_case ? resolve(s.load_case) : null;
    return {
      ...base,
      kind: "sweep",
      sweep: {
        laminateId: s.laminate_uuid,
        loadCaseId: loadCase?.loadCaseId ?? null,
        x,
        y,
        outputs,
        plies: Math.max(2, Math.round(s.plies)),
        fractions: [s.fractions[0], s.fractions[1], s.fractions[2]],
      },
    };
  }
  return unknown;
}
