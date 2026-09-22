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
// The worker is single-threaded, so the queue in front of it is this module's
// to manage: only one request is ever posted at a time, and the rest wait here
// where they can still be superseded. A call may name a `slot` - the logical
// thing it computes, e.g. "one laminate's buckling solve" - and a newer call
// for the same slot overwrites the waiting one's arguments instead of queueing
// behind it. Typing a four-digit plate length therefore costs the solve in
// flight plus one more, not four; and holding a key down does not build a
// queue that outlives the typing.
//
// The superseded caller is settled with the SUPERSEDING answer rather than
// rejected: it asked about the same slot, the newer numbers are the better
// answer to that question, and no caller is left hanging on a promise. Work
// already handed to the worker cannot be recalled - that would need the Rust
// side to check an abort flag inside the solver - so a slot costs at most two
// solves, not one.
//
// Calls with no slot (import, export, an optimisation run) are never
// superseded: they are one-shot user actions, not live recomputation.
import type { WasmEntryPoint, WasmRequest, WasmResponse } from "./wasm.worker";

type Pending = { resolve: (value: string) => void; reject: (error: unknown) => void };

/** A call waiting its turn. `waiting` holds every caller this entry answers -
 *  more than one once it has superseded an earlier call for the same slot. */
type Queued = {
  fn: WasmEntryPoint;
  args: (string | number)[];
  slot: string | null;
  waiting: Pending[];
};

let worker: Worker | null = null;
let nextId = 1;
/** Posted to the worker and awaiting its answer, by request id. */
const pending = new Map<number, Pending[]>();
/** Not yet posted, in the order they were made. */
const queue: Queued[] = [];
let inFlight = false;

/** In-thread fallback, for environments without workers (the Node test setup,
 *  and any browser where constructing one throws). Same module, same call. */
let fallback: Promise<typeof import("../wasm-pkg/elamx_wasm.js")> | null = null;

function loadInThread() {
  if (!fallback) {
    fallback = import("../wasm-pkg/elamx_wasm.js").then(async (mod) => {
      // wasm-bindgen's `--target web` init fetches the .wasm beside the JS.
      // Under Node that fetch fails ("not implemented... yet..."), so the test
      // suite could not call the core at all and every wasm-backed atom went
      // unchecked. Reading the file and handing over the bytes is the same
      // init, and it is what lets a store test compare against the real
      // calculation instead of a stand-in for it.
      await mod.default(isNode() ? { module_or_path: await readWasm() } : undefined);
      return mod;
    });
  }
  return fallback;
}

// Reached through `globalThis` and behind variable specifiers, so that the
// app's tsconfig - which has no Node types on purpose, this being browser
// code - does not have to grow them for three lines that never run in a
// browser, and so that the bundler leaves the imports alone.
function isNode(): boolean {
  return (
    (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node !==
    undefined
  );
}

async function readWasm(): Promise<Uint8Array> {
  const fsModule = "node:fs/promises";
  const urlModule = "node:url";
  const { readFile } = (await import(/* @vite-ignore */ fsModule)) as {
    readFile: (path: string) => Promise<Uint8Array>;
  };
  const { fileURLToPath } = (await import(/* @vite-ignore */ urlModule)) as {
    fileURLToPath: (url: URL) => string;
  };
  return readFile(fileURLToPath(new URL("../wasm-pkg/elamx_wasm_bg.wasm", import.meta.url)));
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
      // A late answer from a worker that has since been replaced: its callers
      // were already rejected when it died, and letting it through would clear
      // the live worker's `inFlight` and hand the queue to a dead one.
      if (created !== worker) return;
      const entries = pending.get(event.data.id);
      inFlight = false;
      if (entries) {
        pending.delete(event.data.id);
        for (const entry of entries) {
          if (event.data.ok) entry.resolve(event.data.value);
          else entry.reject(event.data.error);
        }
      }
      pump(created);
    };
    // A worker that dies takes every call with it, the queued ones as much as
    // the one in flight. Failing them loudly beats promises that never settle
    // and panels stuck on "computing" - and `worker` is cleared, so the next
    // call builds a fresh one (or falls back in-thread) instead of posting
    // into the void, which would hang exactly as this is meant to prevent.
    created.onerror = () => {
      const stranded = [...pending.values(), ...queue.map((entry) => entry.waiting)];
      worker = null;
      inFlight = false;
      pending.clear();
      queue.length = 0;
      for (const group of stranded) {
        for (const entry of group) entry.reject("calculation worker stopped");
      }
    };
    return created;
  } catch {
    return null;
  }
}

/** Hands the worker the next waiting call, if it is free to take one. */
function pump(active: Worker) {
  if (active !== worker || inFlight || queue.length === 0) return;
  const next = queue.shift()!;
  const id = nextId++;
  pending.set(id, next.waiting);
  inFlight = true;
  active.postMessage({ id, fn: next.fn, args: next.args } satisfies WasmRequest);
}

async function call(
  fn: WasmEntryPoint,
  args: (string | number)[],
  slot: string | null = null,
): Promise<string> {
  if (worker === null) worker = startWorker();

  if (worker === null) {
    const mod = await loadInThread();
    return (mod[fn] as (...a: (string | number)[]) => string)(...args);
  }

  const active = worker;
  return new Promise<string>((resolve, reject) => {
    const entry: Pending = { resolve, reject };
    if (slot !== null) {
      const waiting = queue.find((q) => q.fn === fn && q.slot === slot);
      if (waiting) {
        // Same slot, newer numbers: keep its place in the queue, answer both
        // callers with the newer result. Nothing is dropped, only recomputed
        // once instead of twice.
        waiting.args = args;
        waiting.waiting.push(entry);
        return;
      }
    }
    queue.push({ fn, args, slot, waiting: [entry] });
    pump(active);
  });
}

/** The calculation core. Every method takes and returns JSON, and rejects with
 *  the core's own message - the same contract the direct calls had.
 *
 *  The live ones take a `slot` as their last argument: the thing being
 *  computed, usually a laminate id. Two calls naming the same slot are the
 *  same question asked twice, and only the later one is worth answering - see
 *  the note at the top. Passing nothing keeps the old behaviour (every call
 *  runs), which is what the one-shot entry points below want. The slot must
 *  distinguish laminates: the comparison view computes several at once, and a
 *  shared slot would have them superseding each other. */
export const elamx = {
  compute_clt: (request: string, slot?: string) => call("compute_clt", [request], slot ?? null),
  compute_angle_sweep: (request: string, deltaAngleDeg: number, slot?: string) =>
    call("compute_angle_sweep", [request, deltaAngleDeg], slot ?? null),
  compute_buckling: (request: string, slot?: string) =>
    call("compute_buckling", [request], slot ?? null),
  compute_buckling_surface: (request: string, slot?: string) =>
    call("compute_buckling_surface", [request], slot ?? null),
  compute_deformation: (request: string, slot?: string) =>
    call("compute_deformation", [request], slot ?? null),
  compute_deformation_field: (request: string, slot?: string) =>
    call("compute_deformation_field", [request], slot ?? null),
  compute_vibration: (request: string, slot?: string) =>
    call("compute_vibration", [request], slot ?? null),
  compute_vibration_surface: (request: string, slot?: string) =>
    call("compute_vibration_surface", [request], slot ?? null),
  compute_spring_in: (request: string, slot?: string) =>
    call("compute_spring_in", [request], slot ?? null),
  compute_cutout: (request: string, slot?: string) =>
    call("compute_cutout", [request], slot ?? null),
  compute_failure_envelope: (request: string, slot?: string) =>
    call("compute_failure_envelope", [request], slot ?? null),
  compute_laminate_envelope: (request: string, slot?: string) =>
    call("compute_laminate_envelope", [request], slot ?? null),
  compute_last_ply_failure: (request: string, slot?: string) =>
    call("compute_last_ply_failure", [request], slot ?? null),
  compute_pressure_vessel: (request: string, slot?: string) =>
    call("compute_pressure_vessel", [request], slot ?? null),
  compute_carpet_plot: (request: string, slot?: string) =>
    call("compute_carpet_plot", [request], slot ?? null),
  compute_layer_stiffness: (request: string, slot?: string) =>
    call("compute_layer_stiffness", [request], slot ?? null),
  resolve_micromechanics: (request: string, slot?: string) =>
    call("resolve_micromechanics", [request], slot ?? null),

  // One-shot user actions, never superseded: each is asked for once, by a
  // click, and its answer is the only one that was ever wanted.
  optimize: (request: string) => call("optimize", [request]),
  import_elamx: (xml: string) => call("import_elamx", [xml]),
  import_elamxb: (xml: string) => call("import_elamxb", [xml]),
  export_elamx: (project: string) => call("export_elamx", [project]),
  /** Returns the deck as TEXT, not JSON - it is what the solver reads. */
  export_solver_deck: (request: string) => call("export_solver_deck", [request]),
};
