/// <reference lib="webworker" />
// The calculation core, off the main thread.
//
// Everything here is one `init()` and a dispatch table: the worker owns the
// wasm instance and answers `{ id, fn, arg }` with `{ id, ok, value }`. It has
// no state of its own beyond the module, because every entry point takes a
// complete request as JSON and returns a complete response as JSON.
import init, * as elamx from "../wasm-pkg/elamx_wasm.js";

/** The entry points the app calls. Anything else is rejected by name rather
 *  than indexed blindly into the module. */
const ENTRY_POINTS = [
  "compute_clt",
  "compute_angle_sweep",
  "compute_buckling",
  "compute_buckling_surface",
  "compute_deformation",
  "compute_failure_envelope",
  "compute_last_ply_failure",
  "compute_pressure_vessel",
  "import_elamx",
  "export_elamx",
] as const;

export type WasmEntryPoint = (typeof ENTRY_POINTS)[number];

export interface WasmRequest {
  id: number;
  fn: WasmEntryPoint;
  /** Arguments in order; every entry point takes a JSON string first, and
   *  `compute_angle_sweep` a number second. */
  args: (string | number)[];
}

export type WasmResponse =
  | { id: number; ok: true; value: string }
  | { id: number; ok: false; error: string };

const ready = init().then(() => elamx);

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<WasmRequest>) => {
  const { id, fn, args } = event.data;
  try {
    if (!(ENTRY_POINTS as readonly string[]).includes(fn)) {
      throw new Error(`unknown entry point '${fn}'`);
    }
    const mod = await ready;
    const call = mod[fn] as (...a: (string | number)[]) => string;
    scope.postMessage({ id, ok: true, value: call(...args) } satisfies WasmResponse);
  } catch (error) {
    // The core rejects with a plain string (`JsValue::from_str`), and the
    // error atoms show it verbatim - so flatten to a string here rather than
    // letting structured cloning decide what an Error survives as.
    scope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WasmResponse);
  }
};
