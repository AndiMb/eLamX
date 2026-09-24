// One point of a study, evaluated: the core's answers reduced to the numbers
// the study asked for.
//
// Pure and synchronous, and shared by the batch worker and the in-thread
// fallback the tests run on. It computes nothing itself (N4): every number is
// read off a core response, the same response the module pages show - which
// is what lets a matrix cell be checked against the CLT page.

import type {
  BucklingResponse,
  CltResponse,
  DeformationResponse,
  LastPlyFailureResponse,
  VibrationResponse,
} from "../types";

/** What a study can report per point. */
export const STUDY_OUTPUTS = [
  "min_rf",
  "lpf",
  "buckling_factor",
  "f1",
  "ex",
  "ey",
  "gxy",
  "max_deflection",
] as const;

export type StudyOutput = (typeof STUDY_OUTPUTS)[number];

/** The core call an output is read from. */
export type PointCall = "clt" | "lpf" | "buckling" | "vibration" | "deformation";

export const OUTPUT_CALL: Record<StudyOutput, PointCall> = {
  min_rf: "clt",
  ex: "clt",
  ey: "clt",
  gxy: "clt",
  lpf: "lpf",
  buckling_factor: "buckling",
  f1: "vibration",
  max_deflection: "deformation",
};

/** One point: the requests the core is asked, as the JSON its entry points
 *  take, and the outputs to read from the answers. Built on the main thread
 *  (lib/study/variation.ts), so the worker needs no project. */
export interface PointTask {
  outputs: StudyOutput[];
  /** Why the point cannot be computed, found before the core is asked - a
   *  p-laminate whose fractions exceed one, for instance. */
  invalid?: string;
  requests: Partial<Record<PointCall, string>>;
}

/** A point's numbers, or the reason there are none. A point that cannot be
 *  computed is a gap with a reason, never an error of the whole study. */
export type PointResult =
  | { ok: true; values: Partial<Record<StudyOutput, number | null>> }
  | { ok: false; reason: string };

/** The entry points a point may call, as the wasm module exports them. */
export interface PointCore {
  compute_clt(request: string): string;
  compute_last_ply_failure(request: string): string;
  compute_buckling(request: string): string;
  compute_vibration(request: string): string;
  compute_deformation(request: string): string;
}

const ENTRY: Record<PointCall, keyof PointCore> = {
  clt: "compute_clt",
  lpf: "compute_last_ply_failure",
  buckling: "compute_buckling",
  vibration: "compute_vibration",
  deformation: "compute_deformation",
};

/** The governing reserve factor over every ply and both ply surfaces. */
export function minReserveFactorOf(result: CltResponse): number | null {
  let min = Infinity;
  for (const layer of result.layer_results) {
    min = Math.min(min, layer.rr_lower.minimal_reserve_factor, layer.rr_upper.minimal_reserve_factor);
  }
  return Number.isFinite(min) ? min : null;
}

function finite(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

function read(output: StudyOutput, response: unknown): number | null {
  switch (output) {
    case "min_rf":
      return minReserveFactorOf(response as CltResponse);
    case "ex":
      return finite((response as CltResponse).engineering_constants.ex_simple);
    case "ey":
      return finite((response as CltResponse).engineering_constants.ey_simple);
    case "gxy":
      return finite((response as CltResponse).engineering_constants.g_simple);
    case "lpf":
      return finite((response as LastPlyFailureResponse).exceedance_factor?.reserve_factor);
    case "buckling_factor":
      return finite((response as BucklingResponse).critical_factor);
    case "f1":
      return finite((response as VibrationResponse).fundamental_frequency);
    case "max_deflection":
      return finite((response as DeformationResponse).max_deflection);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Evaluates one point: each needed call once, however many outputs read
 *  from it. A call the core refuses makes the whole point a gap, with the
 *  core's own words as the reason. */
export function evaluatePoint(core: PointCore, task: PointTask): PointResult {
  if (task.invalid) return { ok: false, reason: task.invalid };
  const answers = new Map<PointCall, unknown>();
  const values: Partial<Record<StudyOutput, number | null>> = {};
  try {
    for (const output of task.outputs) {
      const call = OUTPUT_CALL[output];
      if (!answers.has(call)) {
        const request = task.requests[call];
        if (request === undefined) throw new Error(`no ${call} request for ${output}`);
        answers.set(call, JSON.parse(core[ENTRY[call]](request)));
      }
      values[output] = read(output, answers.get(call));
    }
  } catch (error) {
    // A trap is the module failing, not the point: the instance is not to be
    // trusted with the next point, so the job ends here and the batch client
    // replaces the worker.
    if (error instanceof WebAssembly.RuntimeError) throw error;
    return { ok: false, reason: message(error) };
  }
  return { ok: true, values };
}
