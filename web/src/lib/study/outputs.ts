// How a study's inputs and outputs are named, in which unit, and how a value
// is read out of a point - one table, for the page, the export and the
// report alike.

import { toMetric, type FailureMetric, METRIC_LABEL_KEYS } from "../failureMetric";
import type { QuantityCategory } from "../units";
import type { MessageKey, MessageParams } from "../../i18n";
import type { PointResult, StudyOutput } from "./evaluate";
import type { VariationDef } from "./model";

type Translate = (key: MessageKey, params?: MessageParams) => string;

export interface OutputInfo {
  labelKey: MessageKey;
  /** A quantity the screen formats and converts. */
  category?: QuantityCategory;
  /** A unit shown as it is, where there is no category for it. */
  unit?: string;
  /** Read in the failure metric (RF, IRF, MoS) the user chose. */
  metric?: boolean;
  decimals?: number;
}

export const OUTPUT_INFO: Record<StudyOutput, OutputInfo> = {
  min_rf: { labelKey: "study.output.min_rf", category: "reserveFactor", metric: true },
  lpf: { labelKey: "study.output.lpf", category: "reserveFactor", metric: true },
  buckling_factor: { labelKey: "study.output.buckling_factor", decimals: 3 },
  f1: { labelKey: "study.output.f1", unit: "Hz", decimals: 2 },
  ex: { labelKey: "study.output.ex", category: "stiffness" },
  ey: { labelKey: "study.output.ey", category: "stiffness" },
  gxy: { labelKey: "study.output.gxy", category: "stiffness" },
  max_deflection: { labelKey: "study.output.max_deflection", unit: "mm", decimals: 4 },
};

/** An output's value at a point - in the failure metric where it is a
 *  reserve factor - or null for a gap or a point not computed yet. */
export function outputValue(point: PointResult | undefined, output: StudyOutput, metric: FailureMetric): number | null {
  if (!point || !point.ok) return null;
  const value = point.values[output];
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return OUTPUT_INFO[output].metric ? toMetric(value, metric) : value;
}

/** An output's name, with the metric where it has one. */
export function outputLabel(output: StudyOutput, metric: FailureMetric, t: Translate): string {
  const info = OUTPUT_INFO[output];
  const name = t(info.labelKey);
  if (info.metric) return `${name} (${t(METRIC_LABEL_KEYS[metric])})`;
  return info.unit ? `${name} [${info.unit}]` : name;
}

const COMPONENT_LABEL: Record<Exclude<VariationDef["component"], "factor">, string> = {
  n_x: "nx [N/mm]",
  n_y: "ny [N/mm]",
  n_xy: "nxy [N/mm]",
  m_x: "mx [N]",
  m_y: "my [N]",
  m_xy: "mxy [N]",
};

/** A varied input's name and unit, as an axis says it. */
export function variationLabel(v: VariationDef, t: Translate): string {
  switch (v.kind) {
    case "angle":
      return `θ [°]`;
    case "thickness":
      return `${t("study.variation.thickness")} [mm]`;
    case "plate":
      return `${v.dim} [mm]`;
    case "fraction":
      return `p${v.family === "45" ? "±45" : v.family} [%]`;
    case "load":
      return v.component === "factor" ? t("study.variation.factor") : COMPONENT_LABEL[v.component];
  }
}

/** A varied input's value as the axis shows it: fractions in percent. */
export function variationValue(v: VariationDef, value: number): number {
  return v.kind === "fraction" ? value * 100 : value;
}
