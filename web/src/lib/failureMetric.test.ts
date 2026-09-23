import { describe, expect, it } from "vitest";
import {
  criticalLayerIndex,
  governingSurface,
  isFailing,
  metricLimit,
  toMetric,
  type FailureMetric,
} from "./failureMetric";
import type { LayerResultDto } from "./types";

const state = { stress: [0, 0, 0], strain: [0, 0, 0] } as LayerResultDto["sss_lower"];
const rf = (value: number) => ({
  failure_name: "x",
  minimal_reserve_factor: value,
  failure_type: "FiberFailure" as const,
});
const layer = (nr: number, lower: number, upper: number): LayerResultDto => ({
  layer_number: nr,
  sss_lower: state,
  sss_upper: state,
  sss_lower_global: state,
  sss_upper_global: state,
  rr_lower: rf(lower),
  rr_upper: rf(upper),
  failed: Math.min(lower, upper) < 1,
  governing_lower: "puck",
  governing_upper: "hashin",
  by_criterion: [],
});

describe("Metrik der Reservefaktoren", () => {
  it("rechnet RF in IRF und MoS um", () => {
    expect(toMetric(2, "rf")).toBe(2);
    expect(toMetric(2, "irf")).toBe(0.5);
    expect(toMetric(2, "mos")).toBe(1);
    expect(toMetric(0.8, "mos")).toBeCloseTo(-0.2, 15);
    // No load: an infinite reserve.
    expect(toMetric(Infinity, "irf")).toBe(0);
    expect(toMetric(Infinity, "mos")).toBe(Infinity);
  });

  it("kennt Grenze und Richtung je Metrik, und alle drei sagen dasselbe", () => {
    expect([metricLimit("rf"), metricLimit("irf"), metricLimit("mos")]).toEqual([1, 1, 0]);
    for (const value of [0.5, 0.999, 1, 1.001, 3, Infinity]) {
      const verdicts = (["rf", "irf", "mos"] as FailureMetric[]).map((m) => isFailing(toMetric(value, m), m));
      expect(new Set(verdicts).size, `RF ${value}`).toBe(1);
      expect(verdicts[0]).toBe(value < 1);
    }
  });

  it("findet die maßgebende Seite und die kritische Lage", () => {
    expect(governingSurface(layer(1, 2, 1.5))).toMatchObject({ position: "upper", criterion: "hashin" });
    // A tie goes to the lower surface, as in the core.
    expect(governingSurface(layer(1, 2, 2)).position).toBe("lower");
    expect(criticalLayerIndex([layer(1, 3, 4), layer(2, 2, 1.2), layer(3, 1.2, 5)])).toBe(1);
    expect(criticalLayerIndex([])).toBe(-1);
  });
});
