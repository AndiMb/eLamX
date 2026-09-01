// The client side of the calculation worker.
//
// Every result in this app is live: there is no "Berechnen" button, so a
// calculation runs on each keystroke. That is affordable for the CLT (0.3 ms
// for sixteen plies) and not at all for plate buckling, whose eigenvalue
// problem grows with the cube of the term count - 15 ms at the default ten
// terms, 792 ms at the twenty the convergence warning asks for. Measured on
// the main thread, typing a four-digit plate length at twenty terms blocked it
// for 1749 ms across four long tasks; the page simply stopped responding.
//
// So the core runs in a worker and this module is the RPC. The call sites keep
// the shape they had - `await elamx.compute_buckling(json)` instead of
// `(await loadElamxWasm()).compute_buckling(json)` - because they were written
// for this move.
//
// Superseded requests are not cancelled: the worker is single-threaded and
// works its queue in order. What that buys is a responsive UI while the queue
// drains, not less work. Cancelling would need the Rust side to check an abort
// flag inside the solver, which is a change to make when someone actually
// waits on the queue rather than on the main thread.
import type { WasmEntryPoint, WasmRequest, WasmResponse } from "./wasm.worker";

type Pending = { resolve: (value: string) => void; reject: (error: unknown) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

/** In-thread fallback, for environments without workers (the Node test setup,
 *  and any browser where constructing one throws). Same module, same call. */
let fallback: Promise<typeof import("../wasm-pkg/elamx_wasm.js")> | null = null;

function loadInThread() {
  if (!fallback) {
    fallback = import("../wasm-pkg/elamx_wasm.js").then(async (mod) => {
      await mod.default();
      return mod;
    });
  }
  return fallback;
}

function startWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    // `new URL(..., import.meta.url)` is the form Vite recognises: it bundles
    // the worker and rewrites the wasm asset path inside it.
    const created = new Worker(new URL("./wasm.worker.ts", import.meta.url), {
      type: "module",
    });
    created.onmessage = (event: MessageEvent<WasmResponse>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      if (event.data.ok) entry.resolve(event.data.value);
      else entry.reject(event.data.error);
    };
    // A worker that dies takes every in-flight call with it. Failing them
    // loudly beats promises that never settle and panels stuck on "computing".
    created.onerror = () => {
      for (const entry of pending.values()) entry.reject("calculation worker stopped");
      pending.clear();
    };
    return created;
  } catch {
    return null;
  }
}

async function call(fn: WasmEntryPoint, args: (string | number)[]): Promise<string> {
  if (worker === null) worker = startWorker();

  if (worker === null) {
    const mod = await loadInThread();
    return (mod[fn] as (...a: (string | number)[]) => string)(...args);
  }

  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, fn, args } satisfies WasmRequest);
  });
}

/** The calculation core. Every method takes and returns JSON, and rejects with
 *  the core's own message - the same contract the direct calls had. */
export const elamx = {
  compute_clt: (request: string) => call("compute_clt", [request]),
  compute_angle_sweep: (request: string, deltaAngleDeg: number) =>
    call("compute_angle_sweep", [request, deltaAngleDeg]),
  compute_buckling: (request: string) => call("compute_buckling", [request]),
  compute_buckling_surface: (request: string) => call("compute_buckling_surface", [request]),
  compute_deformation: (request: string) => call("compute_deformation", [request]),
  compute_deformation_field: (request: string) => call("compute_deformation_field", [request]),
  compute_failure_envelope: (request: string) => call("compute_failure_envelope", [request]),
  compute_last_ply_failure: (request: string) => call("compute_last_ply_failure", [request]),
  compute_pressure_vessel: (request: string) => call("compute_pressure_vessel", [request]),
  import_elamx: (xml: string) => call("import_elamx", [xml]),
  export_elamx: (project: string) => call("export_elamx", [project]),
};
