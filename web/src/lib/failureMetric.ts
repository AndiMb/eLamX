// How a reserve factor is shown (F2.2): as the reserve factor RF itself, as
// its inverse IRF = 1/RF (the "exposure" some codes and FE tools report), or
// as the margin of safety MoS = RF - 1.
//
// Pure presentation (N4): the core computes reserve factors and only reserve
// factors; these functions re-express them. Which ply or criterion governs is
// decided on the RF and never on the displayed value, so switching the metric
// can change the numbers but not the answer.

import type { MessageKey } from "../i18n";
import type { LayerResultDto, ReserveFactorDto } from "./types";

export type FailureMetric = "rf" | "irf" | "mos";

export const FAILURE_METRICS: readonly FailureMetric[] = ["rf", "irf", "mos"];

/** The reserve factor `rf` in metric `m`. An infinite reserve (no load in any
 *  evaluated direction) is IRF 0 and MoS infinity. */
export function toMetric(rf: number, m: FailureMetric): number {
  switch (m) {
    case "rf":
      return rf;
    case "irf":
      return rf === Infinity ? 0 : 1 / rf;
    case "mos":
      return rf - 1;
  }
}

/** Where the metric crosses from holding to failing: RF 1, IRF 1, MoS 0. */
export function metricLimit(m: FailureMetric): number {
  return m === "mos" ? 0 : 1;
}

/** Whether a value of metric `m` means failure. IRF grows with the load, the
 *  other two shrink - so the comparison turns round, and it is decided here
 *  once rather than at every display. Exactly at the limit holds, as RF 1
 *  does in the core's own `failed` flag. */
export function isFailing(value: number, m: FailureMetric): boolean {
  return m === "irf" ? value > 1 : value < metricLimit(m);
}

/** Whether a larger value of the metric is the safer one. */
export function higherIsSafer(m: FailureMetric): boolean {
  return m !== "irf";
}

export const METRIC_LABEL_KEYS: Record<FailureMetric, MessageKey> = {
  rf: "metric.rf",
  irf: "metric.irf",
  mos: "metric.mos",
};

/** The one-word name of the extreme a panel reports: "min. RF", "max. IRF". */
export const METRIC_GOVERNING_KEYS: Record<FailureMetric, MessageKey> = {
  rf: "metric.governing.rf",
  irf: "metric.governing.irf",
  mos: "metric.governing.mos",
};

/** The surface of a ply that governs it: the smaller reserve factor, the
 *  lower surface on a tie (the order the core scans them in). */
export function governingSurface(layer: LayerResultDto): {
  position: "lower" | "upper";
  rf: ReserveFactorDto;
  criterion: string;
} {
  return layer.rr_upper.minimal_reserve_factor < layer.rr_lower.minimal_reserve_factor
    ? { position: "upper", rf: layer.rr_upper, criterion: layer.governing_upper }
    : { position: "lower", rf: layer.rr_lower, criterion: layer.governing_lower };
}

/** Index of the ply that governs the laminate - the smallest reserve factor
 *  over all plies and both surfaces, the first on a tie - or -1 for none. */
export function criticalLayerIndex(layers: readonly LayerResultDto[]): number {
  let index = -1;
  let minimal = Infinity;
  layers.forEach((layer, i) => {
    const rf = governingSurface(layer).rf.minimal_reserve_factor;
    if (index < 0 || rf < minimal) {
      index = i;
      minimal = rf;
    }
  });
  return index;
}
