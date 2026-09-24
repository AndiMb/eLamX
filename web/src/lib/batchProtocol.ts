// The messages between the app and the batch worker (workers/batch.worker.ts).
//
// Types only, so that the worker and the client can share them without the
// client importing the worker or the worker importing the client.

import type { PointResult, PointTask } from "./study/evaluate";

/** What a batch worker is asked to do.
 *
 *  `points` is a study: every point evaluated in turn and streamed back as it
 *  is done, so a plot can grow while the rest is still computing. `call` is a
 *  single long core call - the optimisation - whose only answer is its end. */
export type BatchJob =
  | { kind: "points"; points: PointTask[] }
  | { kind: "call"; fn: "optimize"; args: string[] };

export type BatchRequest = { type: "run"; jobId: number; job: BatchJob };

export type BatchResponse =
  | { type: "progress"; jobId: number; done: number; total: number }
  | { type: "point"; jobId: number; index: number; value: PointResult }
  /** `value` is the answer of a `call` job; a `points` job has streamed its
   *  answers already. */
  | { type: "done"; jobId: number; value?: string }
  /** `fatal`: the module trapped, and the worker must not run another job. */
  | { type: "error"; jobId: number; message: string; fatal?: boolean };
