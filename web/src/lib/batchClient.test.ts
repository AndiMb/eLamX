// The batch client: lazy start, one job at a time, cancel by terminate, idle
// shutdown. The worker is faked; the in-thread fallback runs the real core.
import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchCancelled, BatchClient, type WorkerLike } from "./batchClient";
import type { BatchRequest, BatchResponse } from "./batchProtocol";
import type { PointResult, PointTask } from "./study/evaluate";
import { buildCltRequest, laminateDtoOf } from "../store/derivedAtoms";
import { defaultLaminateConfig, defaultLoadCase } from "../store/laminateAtoms";
import { defaultMaterial } from "./constants";
import { elamx } from "./wasm";

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<BatchResponse>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly posted: BatchRequest[] = [];
  terminated = false;

  postMessage(message: BatchRequest) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  send(message: BatchResponse) {
    this.onmessage?.({ data: message } as MessageEvent<BatchResponse>);
  }
}

function fakeClient(idleMs = 60_000) {
  const workers: FakeWorker[] = [];
  const client = new BatchClient({
    idleMs,
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
  return { client, workers };
}

const job = { kind: "points" as const, points: [] as PointTask[] };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("the batch client", () => {
  it("starts no worker before the first job", () => {
    const { client, workers } = fakeClient();
    expect(workers).toHaveLength(0);
    expect(client.alive).toBe(false);
  });

  it("streams points and progress and resolves on done", async () => {
    const { client, workers } = fakeClient();
    const points: [number, PointResult][] = [];
    const progress: number[] = [];
    const handle = client.run(job, {
      onPoint: (i, v) => points.push([i, v]),
      onProgress: (done) => progress.push(done),
    });
    const worker = workers[0];
    const { jobId } = worker.posted[0];
    worker.send({ type: "progress", jobId, done: 0, total: 2 });
    worker.send({ type: "point", jobId, index: 0, value: { ok: true, values: { min_rf: 2 } } });
    worker.send({ type: "point", jobId, index: 1, value: { ok: false, reason: "no" } });
    worker.send({ type: "progress", jobId, done: 2, total: 2 });
    worker.send({ type: "done", jobId });
    await expect(handle.promise).resolves.toBeUndefined();
    expect(points.map(([i]) => i)).toEqual([0, 1]);
    expect(progress).toEqual([0, 2]);
  });

  it("runs one job at a time, in order", async () => {
    const { client, workers } = fakeClient();
    const first = client.run(job);
    const second = client.run({ kind: "call", fn: "optimize", args: ["{}"] });
    const worker = workers[0];
    expect(worker.posted).toHaveLength(1);
    worker.send({ type: "done", jobId: worker.posted[0].jobId });
    await first.promise;
    expect(worker.posted).toHaveLength(2);
    worker.send({ type: "done", jobId: worker.posted[1].jobId, value: "answer" });
    await expect(second.promise).resolves.toBe("answer");
    expect(workers).toHaveLength(1);
  });

  it("cancels a running job by terminating its worker, and starts a fresh one for the next", async () => {
    const { client, workers } = fakeClient();
    const running = client.run(job);
    const waiting = client.run(job);
    running.cancel();
    await expect(running.promise).rejects.toBeInstanceOf(BatchCancelled);
    expect(workers[0].terminated).toBe(true);
    // The waiting job moved on to a new worker.
    expect(workers).toHaveLength(2);
    expect(workers[1].posted).toHaveLength(1);
    // A late answer of the killed worker is ignored.
    workers[0].send({ type: "done", jobId: workers[0].posted[0].jobId });
    workers[1].send({ type: "done", jobId: workers[1].posted[0].jobId });
    await expect(waiting.promise).resolves.toBeUndefined();
  });

  it("cancels a waiting job without touching the running one", async () => {
    const { client, workers } = fakeClient();
    const running = client.run(job);
    const waiting = client.run(job);
    waiting.cancel();
    await expect(waiting.promise).rejects.toBeInstanceOf(BatchCancelled);
    expect(workers[0].terminated).toBe(false);
    workers[0].send({ type: "done", jobId: workers[0].posted[0].jobId });
    await expect(running.promise).resolves.toBeUndefined();
    expect(workers[0].posted).toHaveLength(1);
  });

  it("reports a job error and a dead worker as a rejection", async () => {
    const { client, workers } = fakeClient();
    const failing = client.run(job);
    workers[0].send({ type: "error", jobId: workers[0].posted[0].jobId, message: "boom" });
    await expect(failing.promise).rejects.toBe("boom");
    const stranded = client.run(job);
    workers[0].onerror?.(new Event("error"));
    await expect(stranded.promise).rejects.toBe("batch worker stopped");
    expect(client.alive).toBe(false);
  });

  it("shuts the worker down after the idle time, and not while busy", async () => {
    vi.useFakeTimers();
    const { client, workers } = fakeClient(1000);
    const handle = client.run(job);
    vi.advanceTimersByTime(5000);
    expect(workers[0].terminated).toBe(false);
    workers[0].send({ type: "done", jobId: workers[0].posted[0].jobId });
    await handle.promise;
    vi.advanceTimersByTime(999);
    expect(workers[0].terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(workers[0].terminated).toBe(true);
    expect(client.alive).toBe(false);
  });
});

describe("the in-thread fallback", () => {
  const material = defaultMaterial();
  const materials = { [material.id]: material };
  const laminate = laminateDtoOf(defaultLaminateConfig("lam", "L", material.id));
  const task = (nx: number): PointTask => {
    const loadCase = { ...defaultLoadCase("1"), dofValues: [nx, 0, 0, 0, 0, 0] };
    return { outputs: ["min_rf", "ex"], requests: { clt: JSON.stringify(buildCltRequest(laminate, materials, loadCase)) } };
  };

  it("evaluates points with the real core, the same numbers the CLT gives", async () => {
    const client = new BatchClient({ createWorker: () => null });
    const results: PointResult[] = [];
    await client.run({ kind: "points", points: [task(1000), task(2000)] }, { onPoint: (i, v) => (results[i] = v) })
      .promise;
    const direct = JSON.parse(await elamx.compute_clt(task(1000).requests.clt!));
    expect(results[0]).toEqual({
      ok: true,
      values: {
        min_rf: Math.min(
          ...direct.layer_results.flatMap((l: { rr_lower: { minimal_reserve_factor: number }; rr_upper: { minimal_reserve_factor: number } }) => [
            l.rr_lower.minimal_reserve_factor,
            l.rr_upper.minimal_reserve_factor,
          ]),
        ),
        ex: direct.engineering_constants.ex_simple,
      },
    });
    // Twice the load, half the reserve.
    const [a, b] = results as { ok: true; values: { min_rf: number } }[];
    expect(b.values.min_rf).toBeCloseTo(a.values.min_rf / 2, 10);
  });

  it("turns a request the core refuses into a gap with the core's reason", async () => {
    const client = new BatchClient({ createWorker: () => null });
    const results: PointResult[] = [];
    await client.run(
      { kind: "points", points: [{ outputs: ["min_rf"], requests: { clt: "{}" } }, { outputs: ["min_rf"], invalid: "why", requests: {} }] },
      { onPoint: (i, v) => (results[i] = v) },
    ).promise;
    expect(results[0].ok).toBe(false);
    expect(results[1]).toEqual({ ok: false, reason: "why" });
  });

  it("stops between two points when cancelled", async () => {
    const client = new BatchClient({ createWorker: () => null });
    const seen: number[] = [];
    const handle = client.run({ kind: "points", points: Array.from({ length: 50 }, () => task(1000)) }, {
      onPoint: (i) => seen.push(i),
    });
    await tick();
    await tick();
    handle.cancel();
    await expect(handle.promise).rejects.toBeInstanceOf(BatchCancelled);
    const count = seen.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen.length).toBe(count);
    expect(count).toBeLessThan(50);
  });
});
