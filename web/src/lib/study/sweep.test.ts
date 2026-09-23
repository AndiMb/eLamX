// The sweep: each variation as a pure change of the input, the p-laminate's
// rounding, and - since a sweep computes nothing itself - checks that its
// numbers are the mechanics' own: the closed-form off-axis modulus, the polar
// diagram and the carpet plot.
import { describe, expect, it } from "vitest";
import { defaultMaterial, type LayerRow } from "../constants";
import { defaultBucklingInput } from "../../store/bucklingAtoms";
import { defaultVibrationInput } from "../../store/vibrationAtoms";
import { defaultDeformationInput } from "../../store/deformationAtoms";
import { defaultLaminateConfig, defaultLoadCase, type LaminateConfig } from "../../store/laminateAtoms";
import { loadCoreInThread } from "../wasm";
import { costLevel, CONFIRM_MS, WARN_MS } from "./cost";
import { evaluatePoint } from "./evaluate";
import { defaultSweep, defaultVariation, type SweepDef, type VariationDef } from "./model";
import type { PlanMessages, StudyProject } from "./plan";
import { planSweep, type SweepLayout } from "./sweep";
import { applyVariation, pLaminate, pliesByFraction, rangeValues, resolveFractions, type SweepInput } from "./variation";
import type { CarpetPlotDto, CltResponse, AngleSweepResponse } from "../types";

const MESSAGES: PlanMessages = {
  lpfNeedsLoads: "lpf needs loads",
  fractionsExceedOne: "too much",
  fractionsUndetermined: "undetermined",
  noLayers: "no layers",
};

const MATERIAL = { ...defaultMaterial(), id: "cfk" };

function layer(id: string, angle: number, thickness = 0.25): LayerRow {
  return { id, name: id, angle, thickness, materialId: "cfk", criterionId: "puck" };
}

function laminate(layers: LayerRow[], symmetric = false): LaminateConfig {
  return {
    ...defaultLaminateConfig("lam", "Basis", "cfk"),
    layers,
    symmetric,
    loadCases: [{ ...defaultLoadCase("LF"), id: "lc", dofValues: [500, 100, 20, 0, 0, 0] }],
  };
}

function input(config: LaminateConfig): SweepInput {
  return {
    laminate: config,
    loadCase: config.loadCases[0],
    buckling: defaultBucklingInput(),
    vibration: defaultVibrationInput(),
    deformation: defaultDeformationInput(),
    fractions: null,
  };
}

function project(config: LaminateConfig, extra: Partial<StudyProject> = {}): StudyProject {
  return { laminates: [config], materials: [MATERIAL], bucklings: {}, vibrations: {}, deformations: {}, lastPlyFailures: {}, ...extra };
}

const v = (kind: VariationDef["kind"], patch: Partial<VariationDef> = {}): VariationDef => ({ ...defaultVariation(kind), ...patch });

describe("applyVariation", () => {
  const base = input(laminate([layer("a", 0), layer("b", 0), layer("c", 90)]));

  it("sets the chosen plies to theta and the negated ones to minus theta", () => {
    const out = applyVariation(base, v("angle", { layers: ["a"], negated: ["b"] }), 30);
    expect(out.laminate.layers.map((l) => l.angle)).toEqual([30, -30, 90]);
    // No ply named: every ply.
    expect(applyVariation(base, v("angle"), 15).laminate.layers.map((l) => l.angle)).toEqual([15, 15, 15]);
    // Pure: the input is untouched.
    expect(base.laminate.layers.map((l) => l.angle)).toEqual([0, 0, 90]);
  });

  it("sets the thickness of the chosen plies, or of all", () => {
    expect(applyVariation(base, v("thickness", { layers: ["c"] }), 0.4).laminate.layers.map((l) => l.thickness)).toEqual([0.25, 0.25, 0.4]);
    expect(applyVariation(base, v("thickness"), 0.1).laminate.layers.map((l) => l.thickness)).toEqual([0.1, 0.1, 0.1]);
  });

  it("sets one load component, or scales every prescribed load and no strain", () => {
    expect(applyVariation(base, v("load", { component: "n_xy" }), 77).loadCase.dofValues).toEqual([500, 100, 77, 0, 0, 0]);
    const strained = { ...base, loadCase: { ...base.loadCase, useStrain: [false, true, false, false, false, false] } };
    expect(applyVariation(strained, v("load", { component: "factor" }), 2).loadCase.dofValues).toEqual([1000, 100, 40, 0, 0, 0]);
    // Varying a strained component makes it a load.
    const asLoad = applyVariation(strained, v("load", { component: "n_y" }), 5).loadCase;
    expect(asLoad.useStrain[1]).toBe(false);
    expect(asLoad.dofValues[1]).toBe(5);
  });

  it("sets a plate edge on every plate module", () => {
    const out = applyVariation(base, v("plate", { dim: "b" }), 321);
    expect([out.buckling.width, out.vibration.width, out.deformation.width]).toEqual([321, 321, 321]);
    expect(out.buckling.length).toBe(base.buckling.length);
  });

  it("records a ply fraction for the p-laminate", () => {
    const out = applyVariation(applyVariation(base, v("fraction", { family: "45" }), 0.3), v("fraction", { family: "0" }), 0.5);
    expect(out.fractions).toEqual({ value: [0.5, 0.3, 0], given: [true, true, false] });
  });

  it("spans the range with both ends", () => {
    expect(rangeValues({ from: 0, to: 90, steps: 4 })).toEqual([0, 30, 60, 90]);
    expect(rangeValues({ from: 5, to: 9, steps: 1 })).toEqual([5]);
  });
});

describe("the p-laminate", () => {
  it("rounds by largest remainders and gives +-45 only in pairs", () => {
    expect(pliesByFraction(16, [0.5, 0.25, 0.25])).toEqual({ a: 4, b: 1, c: 2 });
    // Thirds of eight: 2.67 / 1.33 / 2.67 - the two larger remainders win.
    expect(pliesByFraction(16, [1 / 3, 1 / 3, 1 / 3])).toEqual({ a: 3, b: 1, c: 3 });
    // A single ply left over cannot be half a pair.
    expect(pliesByFraction(10, [0.1, 0.9, 0])).toEqual({ a: 1, b: 2, c: 0 });
    for (const plies of [8, 12, 16, 24, 32]) {
      for (const f of [[0.2, 0.5, 0.3], [0.7, 0.1, 0.2], [0, 1, 0], [0.45, 0.1, 0.45]] as [number, number, number][]) {
        const { a, b, c } = pliesByFraction(plies, f);
        expect(a + 2 * b + c).toBe(plies / 2);
      }
    }
  });

  it("stacks 0, +-45, 90 in that order, symmetric, from the first ply", () => {
    const base = laminate([{ ...layer("x", 30, 0.2), criterionId: "tsai_wu" }]);
    const p = pLaminate(base, 12, [1 / 3, 1 / 3, 1 / 3]);
    expect(p.symmetric).toBe(true);
    expect(p.layers.map((l) => l.angle)).toEqual([0, 0, 45, -45, 90, 90]);
    expect(p.layers.every((l) => l.thickness === 0.2 && l.criterionId === "tsai_wu")).toBe(true);
  });

  it("shares the rest among the fractions not varied, in the start proportions", () => {
    expect(resolveFractions({ value: [0.4, 0, 0], given: [true, false, false] }, [0.5, 0.25, 0.25])).toEqual([0.4, 0.3, 0.3]);
    expect(resolveFractions({ value: [0.7, 0.5, 0], given: [true, true, false] }, [0.5, 0.25, 0.25])).toBe("exceedsOne");
    expect(resolveFractions({ value: [0.5, 0, 0], given: [true, false, false] }, [1, 0, 0])).toBe("undetermined");
  });
});

describe("the sweep's numbers are the mechanics'", () => {
  it("Ex of a single ply over theta is the off-axis transformation formula", async () => {
    const core = await loadCoreInThread();
    const config = laminate([layer("p", 0)]);
    const def: SweepDef = { ...defaultSweep(config.id), x: v("angle", { from: 0, to: 90, steps: 19 }), outputs: ["ex"] };
    const plan = planSweep(def, project(config), MESSAGES);
    const { e_par: e1, e_nor: e2, g: g12, nue12: nu12 } = MATERIAL;
    rangeValues(def.x).forEach((theta, i) => {
      const c = Math.cos((theta * Math.PI) / 180);
      const s = Math.sin((theta * Math.PI) / 180);
      const closed = 1 / (c ** 4 / e1 + (1 / g12 - (2 * nu12) / e1) * s * s * c * c + s ** 4 / e2);
      const point = evaluatePoint(core, plan.points[i]);
      expect(point.ok).toBe(true);
      if (point.ok) expect(point.values.ex! / closed).toBeCloseTo(1, 10);
    });
  });

  it("the ply's A11 over theta is the polar diagram of the 0-degree ply", async () => {
    const core = await loadCoreInThread();
    const config = laminate([layer("p", 0)]);
    const polar = JSON.parse(
      core.compute_angle_sweep(JSON.stringify({ laminate: { ...config, layers: [{ ...config.layers[0], material_id: "cfk", criterion_id: "puck", extra_criteria: [] }], with_middle_layer: false, invert_z: false }, materials: { cfk: MATERIAL } }), 5),
    ) as AngleSweepResponse;
    const def: SweepDef = { ...defaultSweep(config.id), x: v("angle", { from: 0, to: 90, steps: 19 }), outputs: ["ex"] };
    const plan = planSweep(def, project(config), MESSAGES);
    rangeValues(def.x).forEach((theta, i) => {
      const clt = JSON.parse(core.compute_clt(plan.points[i].requests.clt!)) as CltResponse;
      const at = polar.angle_deg.findIndex((a) => Math.abs(a - theta) < 1e-9);
      expect(clt.abd[0][0] / polar.a11[at]).toBeCloseTo(1, 10);
    });
  });

  it("Ex of a p-laminate is the carpet plot's value at the same mix", async () => {
    const core = await loadCoreInThread();
    const carpet = JSON.parse(core.compute_carpet_plot(JSON.stringify({ material: MATERIAL, value: "ex" }))) as CarpetPlotDto;
    const config = laminate([layer("t", 0, 0.125)]);
    // The end of the curve at 50 % and at 20 % zero-degree plies: the rest is
    // all +-45, and 16 and 20 plies make those mixes exactly.
    for (const [curve, plies] of [
      [5, 16],
      [2, 20],
    ]) {
      const f0 = carpet.curves[curve].fraction_0;
      const def: SweepDef = {
        ...defaultSweep(config.id),
        x: v("fraction", { family: "0", from: f0, to: f0, steps: 1 }),
        outputs: ["ex"],
        plies,
        fractions: [0, 1, 0],
      };
      const plan = planSweep(def, project(config), MESSAGES);
      const point = evaluatePoint(core, plan.points[0]);
      const values = carpet.curves[curve].values;
      expect(point.ok).toBe(true);
      if (point.ok) expect(point.values.ex! / values[values.length - 1]).toBeCloseTo(1, 9);
    }
  });
});

describe("planning a sweep", () => {
  it("lays out a carpet: x fastest, one row of points per y value", () => {
    const config = laminate([layer("a", 0), layer("b", 90)]);
    const def: SweepDef = {
      ...defaultSweep(config.id),
      x: v("angle", { layers: ["a"], from: 0, to: 90, steps: 4 }),
      y: v("plate", { dim: "a", from: 200, to: 600, steps: 3 }),
      outputs: ["min_rf", "buckling_factor"],
    };
    const plan = planSweep(def, project(config), MESSAGES);
    const layout = plan.layout as SweepLayout;
    expect(plan.points).toHaveLength(12);
    expect(layout.x.values).toEqual([0, 30, 60, 90]);
    expect(layout.y!.values).toEqual([200, 400, 600]);
    const buckling = JSON.parse(plan.points[5].requests.buckling!);
    expect(buckling.input.length).toBe(400);
    expect(buckling.laminate.layers[0].angle).toBe(30);
  });

  it("caps plate terms at 12 and says so", () => {
    const config = laminate([layer("a", 0), layer("b", 90)]);
    const def: SweepDef = { ...defaultSweep(config.id), outputs: ["buckling_factor"] };
    const plan = planSweep(def, project(config, { bucklings: { lam: { ...defaultBucklingInput(), m: 20, n: 15 } } }), MESSAGES);
    expect(JSON.parse(plan.points[0].requests.buckling!).input).toMatchObject({ m: 12, n: 12 });
    expect(plan.problems).toContainEqual({ kind: "termsCapped", max: 12 });
  });

  it("makes gaps with reasons, not errors", async () => {
    const core = await loadCoreInThread();
    const config = laminate([layer("a", 0), layer("b", 90)]);
    const def: SweepDef = {
      ...defaultSweep(config.id),
      x: v("fraction", { family: "0", from: 0.5, to: 1.5, steps: 3 }),
      y: v("fraction", { family: "45", from: 0, to: 0, steps: 1 }),
      outputs: ["min_rf"],
    };
    const plan = planSweep(def, project(config), MESSAGES);
    expect(plan.points.map((p) => p.invalid ?? "ok")).toEqual(["ok", "ok", "too much"]);
    expect(evaluatePoint(core, plan.points[2])).toEqual({ ok: false, reason: "too much" });
  });

  it("prices buckling by the stack: a cross-ply's 400 points pass, angled plies' warn", () => {
    const config = laminate([layer("a", 0), layer("b", 90)]);
    const plate: SweepDef = {
      ...defaultSweep(config.id),
      x: v("plate", { dim: "b", from: 200, to: 800, steps: 20 }),
      y: v("plate", { from: 200, to: 800, steps: 20 }),
      outputs: ["buckling_factor"],
    };
    const crossPly = planSweep(plate, project(config), MESSAGES);
    expect(crossPly.points).toHaveLength(400);
    expect(crossPly.cost.level).toBe("ok");
    // Every ply turned: the bend-twist coupling makes each solve ten times
    // dearer - measured 19 s for these 400 points in a browser.
    const angled = planSweep({ ...plate, x: v("angle", { from: 0, to: 90, steps: 20 }) }, project(config), MESSAGES);
    expect(angled.cost.level).toBe("warn");
    expect(angled.cost.ms).toBeGreaterThan(15_000);
    expect(angled.cost.ms).toBeLessThan(40_000);
    expect(costLevel(WARN_MS)).toBe("warn");
    expect(costLevel(CONFIRM_MS)).toBe("confirm");
  });
});
