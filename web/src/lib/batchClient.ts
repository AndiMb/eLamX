// The client side of the batch worker (workers/batch.worker.ts).
//
// Three rules shape it, all about a second core instance being expensive to
// keep and cheap to start:
//
// - Lazy start. Nothing is spawned until the first job - most sessions never
//   run a study, and a worker holds its own copy of the wasm memory (20-40 MB
//   on a phone).
// - Idle shutdown. Sixty seconds after the last job the worker is terminated;
//   the next job pays the ~100 ms of a fresh start.
// - Cancel is terminate. The core has no abort flag and gets none: a cancelled
//   job's worker is killed where it stands, even mid-eigenvalue problem, and
//   the next job starts a new one. The interactive worker (lib/wasm.ts) is a
//   different worker and never notices.
//
// One job runs at a time; later ones wait in order. A caller gets a handle
// with the promise of the whole job and a cancel that works whether the job
// is running or still waiting.
//
// Where no worker can be made (the Node test setup), jobs run in this thread
// on the same evaluator, point by point with a yield in between, so a cancel
// still lands between two points.

import type { BatchJob, BatchRequest, BatchResponse } from "./batchProtocol";
import { evaluatePoint, type PointResult } from "./study/evaluate";
import { loadCoreInThread } from "./wasm";

/** Rejection reason of a cancelled job - to tell a cancel from a failure. */
export class BatchCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "BatchCancelled";
  }
}

export interface BatchCallbacks {
  onProgress?: (done: number, total: number) => void;
  onPoint?: (index: number, value: PointResult) => void;
}

export interface BatchHandle {
  /** Resolves with a `call` job's answer, or undefined for a `points` job
   *  once every point has been reported. */
  promise: Promise<string | undefined>;
  cancel(): void;
}

/** The part of a Worker the client uses - what a test fakes. */
export interface WorkerLike {
  postMessage(message: BatchRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<BatchResponse>) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export interface BatchClientOptions {
  /** Makes a worker, or returns null when there can be none. */
  createWorker?: () => WorkerLike | null;
  /** Milliseconds without a job before the worker is shut down. */
  idleMs?: number;
}

export const IDLE_SHUTDOWN_MS = 60_000;

interface Entry {
  id: number;
  job: BatchJob;
  callbacks: BatchCallbacks;
  resolve: (value: string | undefined) => void;
  reject: (error: unknown) => void;
  cancelled: boolean;
}

function defaultWorker(): WorkerLike | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("../workers/batch.worker.ts", import.meta.url), {
      type: "module",
    }) as unknown as WorkerLike;
  } catch {
    return null;
  }
}

export class BatchClient {
  private readonly createWorker: () => WorkerLike | null;
  private readonly idleMs: number;
  private worker: WorkerLike | null = null;
  private running: Entry | null = null;
  private readonly queue: Entry[] = [];
  private nextId = 1;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** How many workers were started - for tests and for measuring. */
  started = 0;

  constructor(options: BatchClientOptions = {}) {
    this.createWorker = options.createWorker ?? defaultWorker;
    this.idleMs = options.idleMs ?? IDLE_SHUTDOWN_MS;
  }

  /** Whether a worker is alive right now. */
  get alive(): boolean {
    return this.worker !== null;
  }

  /** Whether a job is running or waiting. */
  get busy(): boolean {
    return this.running !== null || this.queue.length > 0;
  }

  run(job: BatchJob, callbacks: BatchCallbacks = {}): BatchHandle {
    let entry!: Entry;
    const promise = new Promise<string | undefined>((resolve, reject) => {
      entry = { id: this.nextId++, job, callbacks, resolve, reject, cancelled: false };
    });
    this.queue.push(entry);
    this.clearIdle();
    this.pump();
    return { promise, cancel: () => this.cancel(entry) };
  }

  private cancel(entry: Entry) {
    if (entry.cancelled) return;
    entry.cancelled = true;
    const waiting = this.queue.indexOf(entry);
    if (waiting >= 0) {
      this.queue.splice(waiting, 1);
      entry.reject(new BatchCancelled());
      return;
    }
    if (this.running !== entry) return;
    // Running: kill the worker where it stands. The in-thread fallback has no
    // worker and notices the flag between two points instead.
    this.running = null;
    this.kill();
    entry.reject(new BatchCancelled());
    this.pump();
  }

  private kill() {
    this.worker?.terminate();
    this.worker = null;
  }

  private clearIdle() {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private scheduleIdle() {
    this.clearIdle();
    if (this.worker === null) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.busy) this.kill();
    }, this.idleMs);
  }

  private settle(entry: Entry, outcome: { value?: string; error?: unknown }) {
    if (this.running !== entry) return;
    this.running = null;
    if ("error" in outcome) entry.reject(outcome.error);
    else entry.resolve(outcome.value);
    this.pump();
  }

  private pump() {
    if (this.running !== null) return;
    const next = this.queue.shift();
    if (!next) {
      this.scheduleIdle();
      return;
    }
    this.running = next;
    if (this.worker === null) {
      this.worker = this.createWorker();
      if (this.worker !== null) {
        this.started += 1;
        this.attach(this.worker);
      }
    }
    if (this.worker === null) {
      void this.runInThread(next);
      return;
    }
    this.worker.postMessage({ type: "run", jobId: next.id, job: next.job });
  }

  private attach(worker: WorkerLike) {
    worker.onmessage = (event) => {
      // A message from a worker since replaced - killed by a cancel - is for
      // a job that has already been settled.
      if (worker !== this.worker) return;
      const entry = this.running;
      const message = event.data;
      if (!entry || message.jobId !== entry.id) return;
      switch (message.type) {
        case "progress":
          entry.callbacks.onProgress?.(message.done, message.total);
          break;
        case "point":
          entry.callbacks.onPoint?.(message.index, message.value);
          break;
        case "done":
          this.settle(entry, { value: message.value });
          break;
        case "error":
          this.settle(entry, { error: message.message });
          break;
      }
    };
    // A worker that dies takes its job with it; the next job gets a new one.
    worker.onerror = () => {
      if (worker !== this.worker) return;
      this.worker = null;
      const entry = this.running;
      if (entry) this.settle(entry, { error: "batch worker stopped" });
    };
  }

  private async runInThread(entry: Entry) {
    try {
      const core = await loadCoreInThread();
      const job = entry.job;
      if (job.kind === "call") {
        const value = core.optimize(job.args[0]);
        if (!entry.cancelled) this.settle(entry, { value });
        return;
      }
      const total = job.points.length;
      entry.callbacks.onProgress?.(0, total);
      for (let index = 0; index < total; index++) {
        // A yield per point, so a cancel issued meanwhile is seen here.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (entry.cancelled) return;
        entry.callbacks.onPoint?.(index, evaluatePoint(core, job.points[index]));
        entry.callbacks.onProgress?.(index + 1, total);
      }
      this.settle(entry, {});
    } catch (error) {
      if (!entry.cancelled) this.settle(entry, { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

/** The app's one batch client. */
export const batchClient = new BatchClient();
