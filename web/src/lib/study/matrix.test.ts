// The matrix: its cells against the CLT module, and which changes to the
// project make it outdated.
import { describe, expect, it } from "vitest";
import { defaultMaterial, type LayerRow } from "../constants";
import { buildCltRequest, laminateDtoOf } from "../../store/derivedAtoms";
import { defaultLaminateConfig, defaultLoadCase, type LaminateConfig } from "../../store/laminateAtoms";
import { loadCoreInThread } from "../wasm";
import { evaluatePoint, minReserveFactorOf } from "./evaluate";
import { defaultMatrix, type MatrixDef } from "./model";
import { planMatrix, type MatrixLayout, type PlanMessages, type StudyProject } from "./plan";
import { matrixTable } from "./tables";
import type { CltResponse } from "../types";

const MESSAGES: PlanMessages = {
  lpfNeedsLoads: "lpf needs loads",
  fractionsExceedOne: "too much",
  fractionsUndetermined: "undetermined",
  noLayers: "no layers",
};

const CFK = { ...defaultMaterial(), id: "cfk", name: "CFK" };
const GFK = { ...defaultMaterial(), id: "gfk", name: "GFK", e_par: 45000, r_par_ten: 1100 };

function layer(id: string, angle: number, materialId = "cfk"): LayerRow {
  return { id, name: `Lage ${id}`, angle, thickness: 0.25, materialId, criterionId: "puck" };
}

function laminate(id: string, angles: number[], materialId = "cfk"): LaminateConfig {
  const config = defaultLaminateConfig(id, `L-${id}`, materialId);
  return {
    ...config,
    layers: angles.map((a, i) => layer(`${id}-${i}`, a, materialId)),
    loadCases: [
      { ...defaultLoadCase("Zug"), id: `${id}-zug`, dofValues: [800, 0, 0, 0, 0, 0] },
      { ...defaultLoadCase("Schub"), id: `${id}-schub`, dofValues: [0, 0, 150, 0, 0, 0] },
    ],
  };
}

function project(): StudyProject {
  return {
    laminates: [laminate("a", [0, 45, -45, 90]), laminate("b", [0, 0, 90, 90]), laminate("g", [45, -45], "gfk")],
    materials: [CFK, GFK],
    bucklings: {},
    vibrations: {},
    deformations: {},
    lastPlyFailures: {},
  };
}

const matrix = (patch: Partial<MatrixDef> = {}): MatrixDef => ({ ...defaultMatrix(), laminates: ["a", "b"], ...patch });

describe("the matrix", () => {
  it("has one cell per laminate and distinct load case, each the CLT page's minimum reserve factor", async () => {
    const core = await loadCoreInThread();
    const p = project();
    const plan = planMatrix(matrix(), p, MESSAGES);
    const layout = plan.layout as MatrixLayout;
    // a's two load cases and b's two - but b's are the same loads as a's.
    expect(layout.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(layout.cols.map((c) => c.loadCaseId)).toEqual(["a-zug", "a-schub"]);
    expect(plan.points).toHaveLength(4);

    // Spot checks against the request the CLT module itself sends (every
    // material, names and all): the same numbers.
    for (const [row, col] of [
      [0, 0],
      [1, 1],
    ]) {
      const config = p.laminates[row];
      const loadCase = p.laminates[0].loadCases[col];
      const direct = JSON.parse(
        core.compute_clt(
          JSON.stringify(
            buildCltRequest(laminateDtoOf(config), { cfk: CFK, gfk: GFK }, loadCase),
          ),
        ),
      ) as CltResponse;
      const cell = evaluatePoint(core, plan.points[row * 2 + col]);
      expect(cell).toEqual({ ok: true, values: { min_rf: minReserveFactorOf(direct) } });
    }
  });

  it("applies another laminate's load case to every row", () => {
    const plan = planMatrix(matrix({ loadCases: [{ laminateId: "b", loadCaseId: "b-schub" }] }), project(), MESSAGES);
    expect((plan.layout as MatrixLayout).cols.map((c) => c.label)).toEqual(["Schub"]);
    expect(plan.points.map((p) => JSON.parse(p.requests.clt!).loads.n_xy)).toEqual([150, 150]);
  });

  it("judges every ply with the column's criterion in criterion columns", async () => {
    const core = await loadCoreInThread();
    const p = project();
    const plan = planMatrix(matrix({ columns: "criterion", criteria: ["max_stress", "tsai_wu"] }), p, MESSAGES);
    expect(plan.points).toHaveLength(4);
    const request = JSON.parse(plan.points[1].requests.clt!);
    expect(request.laminate.layers.every((l: { criterion_id: string }) => l.criterion_id === "tsai_wu")).toBe(true);
    // The row's first load case.
    expect(request.loads.n_x).toBe(800);
    const changed = { ...p.laminates[0], layers: p.laminates[0].layers.map((l) => ({ ...l, criterionId: "max_stress" as const })) };
    const direct = JSON.parse(core.compute_clt(JSON.stringify(buildCltRequest(laminateDtoOf(changed), { cfk: CFK }, p.laminates[0].loadCases[0]))));
    expect(evaluatePoint(core, plan.points[0])).toEqual({ ok: true, values: { min_rf: minReserveFactorOf(direct) } });
  });

  it("leaves a gap with a reason where last ply failure cannot follow a prescribed strain", () => {
    const p = project();
    p.laminates[0].loadCases[1] = { ...p.laminates[0].loadCases[1], useStrain: [true, false, false, false, false, false] };
    const plan = planMatrix(matrix({ laminates: ["a"], output: "lpf" }), p, MESSAGES);
    expect(plan.points[0].requests.lpf).toBeDefined();
    expect(plan.points[1]).toMatchObject({ invalid: "lpf needs loads" });
  });

  it("is outdated by changes to what it computes, and only by those", () => {
    const base = project();
    const hash = planMatrix(matrix(), base, MESSAGES).hash;
    const same = (p: StudyProject) => planMatrix(matrix(), p, MESSAGES).hash === hash;

    // Irrelevant: names, a laminate outside the matrix, a material no row uses.
    expect(same({ ...base, laminates: base.laminates.map((l) => ({ ...l, name: `${l.name}!` })) })).toBe(true);
    expect(
      same({ ...base, laminates: base.laminates.map((l) => (l.id === "g" ? { ...l, layers: [layer("g-0", 30, "gfk")] } : l)) }),
    ).toBe(true);
    expect(same({ ...base, materials: [CFK, { ...GFK, e_par: 1 }, { ...CFK, id: "neu" }] })).toBe(true);
    expect(same({ ...base, materials: [{ ...CFK, name: "anders" }, GFK] })).toBe(true);

    // Relevant: a ply angle, a load, a material a row is made of.
    const a = base.laminates[0];
    expect(same({ ...base, laminates: [{ ...a, layers: [layer("a-0", 10), ...a.layers.slice(1)] }, ...base.laminates.slice(1)] })).toBe(false);
    expect(
      same({
        ...base,
        laminates: [{ ...a, loadCases: [{ ...a.loadCases[0], dofValues: [900, 0, 0, 0, 0, 0] }, a.loadCases[1]] }, ...base.laminates.slice(1)],
      }),
    ).toBe(false);
    expect(same({ ...base, materials: [{ ...CFK, r_par_ten: 1 }, GFK] })).toBe(false);
  });

  it("exports as a table, transposed when shown transposed", () => {
    const plan = planMatrix(matrix(), project(), MESSAGES);
    const points = [
      { ok: true as const, values: { min_rf: 2 } },
      { ok: true as const, values: { min_rf: 0.5 } },
      { ok: false as const, reason: "x" },
      undefined,
    ];
    const t = (key: string) => key;
    const table = matrixTable("M", plan.layout as MatrixLayout, points, "rf", false, t as never);
    expect(table.rows).toEqual([
      ["L-a", 2, 0.5],
      ["L-b", null, null],
    ]);
    const transposed = matrixTable("M", plan.layout as MatrixLayout, points, "mos", true, t as never);
    expect(transposed.columns.map((c) => c.label)).toEqual(["study.matrix.loadCase", "L-a", "L-b"]);
    expect(transposed.rows[0]).toEqual(["Zug", 1, null]);
    expect(transposed.rows[1][1]).toBeCloseTo(-0.5);
  });
});

describe("a point the core cannot answer", () => {
  const failing = (error: unknown) =>
    ({ compute_clt: () => { throw error; } }) as unknown as Parameters<typeof evaluatePoint>[0];
  const task = { outputs: ["min_rf" as const], requests: { clt: "{}" } };

  it("is a gap when the core refuses it", () => {
    expect(evaluatePoint(failing("no plies"), task)).toEqual({ ok: false, reason: "no plies" });
  });

  it("ends the job when the module trapped, so no later point runs on the broken instance", () => {
    expect(() => evaluatePoint(failing(new WebAssembly.RuntimeError("unreachable")), task)).toThrow(
      WebAssembly.RuntimeError,
    );
  });
});
