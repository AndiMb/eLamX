/// <reference lib="webworker" />
// The batch worker: studies and the optimisation, off the interactive worker.
//
// A second instance of the same core. The interactive worker (lib/wasm.ts)
// answers every keystroke and must keep doing so while a 400-point buckling
// sweep runs - with one worker the sweep would sit in front of every live
// recomputation for as long as it takes. Here a job can take minutes without
// anyone waiting on it but the study it belongs to.
//
// It has no way to stop a job part-way, and needs none: cancelling is the
// client terminating this worker and starting a fresh one (lib/batchClient.ts).
// So there is no abort flag to check in the solver loops, and a job cancelled
// mid-eigenvalue problem stops right there instead of at the next check.

import init, * as core from "../wasm-pkg/elamx_wasm.js";
import { evaluatePoint } from "../lib/study/evaluate";
import type { BatchRequest, BatchResponse } from "../lib/batchProtocol";

const ready = init();
const scope = self as unknown as DedicatedWorkerGlobalScope;

/** Progress messages at most this often: a CLT matrix does hundreds of points
 *  a second, and a message per point would be the client's whole workload. */
const PROGRESS_INTERVAL_MS = 100;

function post(message: BatchResponse) {
  scope.postMessage(message);
}

scope.onmessage = async (event: MessageEvent<BatchRequest>) => {
  const { jobId, job } = event.data;
  try {
    await ready;
    if (job.kind === "call") {
      if (job.fn !== "optimize") throw new Error(`unknown batch call '${job.fn}'`);
      post({ type: "done", jobId, value: core.optimize(job.args[0]) });
      return;
    }
    const total = job.points.length;
    let lastProgress = 0;
    post({ type: "progress", jobId, done: 0, total });
    for (let index = 0; index < total; index++) {
      post({ type: "point", jobId, index, value: evaluatePoint(core, job.points[index]) });
      const now = performance.now();
      if (now - lastProgress >= PROGRESS_INTERVAL_MS || index === total - 1) {
        lastProgress = now;
        post({ type: "progress", jobId, done: index + 1, total });
      }
    }
    post({ type: "done", jobId });
  } catch (error) {
    const fatal = error instanceof WebAssembly.RuntimeError;
    const message = error instanceof Error ? error.message : String(error);
    post({
      type: "error",
      jobId,
      message: fatal ? `the calculation core failed internally (${message})` : message,
      fatal,
    });
  }
};
