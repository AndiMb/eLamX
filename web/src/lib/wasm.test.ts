// The RPC in front of the calculation worker: who gets posted, who waits, and
// who is superseded on the way.
//
// The worker itself is faked. What is under test is this module's queue - that
// the worker is handed one request at a time, that a newer call for the same
// slot replaces a waiting one instead of queueing behind it, and that a worker
// that dies leaves neither an unsettled promise nor a dead object to post into.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WasmRequest, WasmResponse } from "./wasm.worker";

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: { data: WasmResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: WasmRequest[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(request: WasmRequest) {
    this.posted.push(request);
  }

  /** Answers the request posted at `index`, as the real worker would. */
  answer(index: number, value: string) {
    this.onmessage?.({ data: { id: this.posted[index].id, ok: true, value } });
  }

  die() {
    this.onerror?.();
  }
}

/** A fresh copy of the module: its queue is module state, not per-call. */
async function freshModule() {
  FakeWorker.instances.length = 0;
  vi.resetModules();
  vi.stubGlobal("Worker", FakeWorker);
  const { elamx } = await import("./wasm");
  return elamx;
}

/** Lets the promises the queue settles run before the next assertion. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("the queue in front of the worker", () => {
  it("posts one request at a time and the next when that one is answered", async () => {
    const elamx = await freshModule();
    const first = elamx.compute_buckling("A", "lam-1");
    const second = elamx.compute_buckling("B", "lam-2");
    await tick();

    const worker = FakeWorker.instances[0];
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0].args).toEqual(["A"]);

    worker.answer(0, "first answer");
    await expect(first).resolves.toBe("first answer");
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[1].args).toEqual(["B"]);

    worker.answer(1, "second answer");
    await expect(second).resolves.toBe("second answer");
  });

  it("does not let one laminate's solve supersede another's", async () => {
    const elamx = await freshModule();
    const a = elamx.compute_buckling("plate A", "lam-1");
    const b = elamx.compute_buckling("plate B", "lam-2");
    await tick();

    const worker = FakeWorker.instances[0];
    worker.answer(0, "A");
    await tick();
    worker.answer(1, "B");

    // Both were computed: the comparison view runs several laminates at once.
    expect(worker.posted.map((r) => r.args[0])).toEqual(["plate A", "plate B"]);
    await expect(a).resolves.toBe("A");
    await expect(b).resolves.toBe("B");
  });
});

describe("superseding", () => {
  it("replaces a waiting call for the same slot instead of queueing behind it", async () => {
    const elamx = await freshModule();
    // Four keystrokes on the same plate: the first is already with the worker,
    // the other three collapse into one.
    const typed = [
      elamx.compute_buckling("500", "lam-1"),
      elamx.compute_buckling("5000", "lam-1"),
      elamx.compute_buckling("5001", "lam-1"),
      elamx.compute_buckling("5012", "lam-1"),
    ];
    await tick();

    const worker = FakeWorker.instances[0];
    expect(worker.posted).toHaveLength(1);

    worker.answer(0, "answer for 500");
    await tick();

    // Two solves for four keystrokes, and the second one uses the newest input.
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[1].args).toEqual(["5012"]);

    worker.answer(1, "answer for 5012");
    // Nobody is left hanging, and the superseded callers get the newer answer
    // rather than a rejection.
    await expect(Promise.all(typed)).resolves.toEqual([
      "answer for 500",
      "answer for 5012",
      "answer for 5012",
      "answer for 5012",
    ]);
  });

  it("keeps the superseded call's place in the queue", async () => {
    const elamx = await freshModule();
    elamx.compute_buckling("in flight", "lam-1");
    elamx.compute_buckling("queued first", "lam-2");
    elamx.compute_buckling("queued second", "lam-3");
    elamx.compute_buckling("queued first, again", "lam-2");
    await tick();

    const worker = FakeWorker.instances[0];
    worker.answer(0, "x");
    await tick();
    worker.answer(1, "y");
    await tick();

    expect(worker.posted.map((r) => r.args[0])).toEqual([
      "in flight",
      "queued first, again",
      "queued second",
    ]);
  });

  it("never supersedes a call that named no slot", async () => {
    const elamx = await freshModule();
    const first = elamx.export_elamx("project one");
    const second = elamx.export_elamx("project two");
    await tick();

    const worker = FakeWorker.instances[0];
    worker.answer(0, "xml one");
    await tick();

    // A save is a one-shot action: both must actually run.
    expect(worker.posted.map((r) => r.args[0])).toEqual(["project one", "project two"]);
    worker.answer(1, "xml two");
    await expect(first).resolves.toBe("xml one");
    await expect(second).resolves.toBe("xml two");
  });

  it("does not supersede across entry points that share a slot", async () => {
    const elamx = await freshModule();
    elamx.compute_buckling("solve", "lam-1");
    elamx.compute_buckling_surface("sample", "lam-1");
    await tick();

    const worker = FakeWorker.instances[0];
    worker.answer(0, "{}");
    await tick();

    expect(worker.posted.map((r) => r.fn)).toEqual([
      "compute_buckling",
      "compute_buckling_surface",
    ]);
  });
});

describe("a worker that dies", () => {
  it("rejects the call in flight and the ones still waiting", async () => {
    const elamx = await freshModule();
    const inFlight = elamx.compute_buckling("A", "lam-1");
    const queued = elamx.compute_buckling("B", "lam-2");
    await tick();

    FakeWorker.instances[0].die();

    await expect(inFlight).rejects.toBe("calculation worker stopped");
    await expect(queued).rejects.toBe("calculation worker stopped");
  });

  it("builds a new worker for the next call instead of posting into the void", async () => {
    const elamx = await freshModule();
    const lost = elamx.compute_buckling("A", "lam-1");
    await tick();
    FakeWorker.instances[0].die();
    await expect(lost).rejects.toBe("calculation worker stopped");

    // The regression: `worker` used to keep pointing at the dead one, so every
    // later call was queued against it and never settled at all.
    const afterwards = elamx.compute_buckling("B", "lam-1");
    await tick();

    expect(FakeWorker.instances).toHaveLength(2);
    const replacement = FakeWorker.instances[1];
    expect(replacement.posted).toHaveLength(1);

    replacement.answer(0, "computed again");
    await expect(afterwards).resolves.toBe("computed again");
  });
});

describe("a replaced worker", () => {
  it("is not handed the new queue by an answer that arrives too late", async () => {
    const elamx = await freshModule();
    const lost = elamx.compute_buckling("A", "lam-1");
    await tick();

    const dead = FakeWorker.instances[0];
    dead.die();
    await expect(lost).rejects.toBe("calculation worker stopped");

    const afterwards = elamx.compute_buckling("B", "lam-1");
    await tick();
    const replacement = FakeWorker.instances[1];

    // The old worker finishes the solve it was already running and answers.
    dead.answer(0, "too late");

    // That must not reach the caller, and must not disturb the live worker.
    expect(dead.posted).toHaveLength(1);
    expect(replacement.posted).toHaveLength(1);
    replacement.answer(0, "the real answer");
    await expect(afterwards).resolves.toBe("the real answer");
  });
});
