// The data behind the charts, as tables - what a chart's "Data (CSV)" saves
// and what the report can list beside a figure. Canonical units, like every
// `TableModel`.

import type { TableModel } from "../export/table";
import type { AngleSweepResponse, CarpetPlotDto, CutoutPointDto } from "../types";
import type { Translate } from ".";

type Triple = readonly [number, number, number] | readonly number[];

/** A ply through the thickness: both surfaces' strains and stresses. */
export interface ThicknessRow {
  number: number;
  zLower: number;
  zUpper: number;
  strain: { lower: Triple; upper: Triple };
  stress: { lower: Triple; upper: Triple };
  /** The ply's reserve factor per surface, where the chart shows it. */
  rf?: { lower: number; upper: number };
}

/** One row per ply surface, top first within a ply as the stack reads. */
export function throughThicknessTable(
  plies: readonly ThicknessRow[],
  system: "local" | "global",
  t: Translate,
): TableModel {
  const [e1, e2, e3, s1, s2, s3] =
    system === "local" ? ["ε1", "ε2", "γ12", "σ1", "σ2", "τ12"] : ["εx", "εy", "γxy", "σx", "σy", "τxy"];
  const withRf = plies.some((p) => p.rf);
  return {
    title: t("chart.throughThickness.title"),
    columns: [
      { key: "ply", label: t("layers.column.nr"), decimals: 0 },
      { key: "surface", label: t("layerResults.surface") },
      { key: "z", label: "z", category: "thickness" },
      { key: "e1", label: e1, category: "strain" },
      { key: "e2", label: e2, category: "strain" },
      { key: "e3", label: e3, category: "strain" },
      { key: "s1", label: s1, category: "stress" },
      { key: "s2", label: s2, category: "stress" },
      { key: "s3", label: s3, category: "stress" },
      ...(withRf ? [{ key: "rf", label: "RF", category: "reserveFactor" as const }] : []),
    ],
    rows: plies.flatMap((p) =>
      (["upper", "lower"] as const).map((side) => [
        p.number,
        t(side === "upper" ? "common.top" : "common.bottom"),
        side === "upper" ? p.zUpper : p.zLower,
        ...p.strain[side],
        ...p.stress[side],
        ...(withRf ? [p.rf ? p.rf[side] : null] : []),
      ]),
    ),
  };
}

const SWEEP_KEYS = ["a11", "a12", "a22", "a66", "b11", "b12", "b22", "b66", "d11", "d12", "d22", "d66"] as const;

export function angleSweepTable(data: AngleSweepResponse, t: Translate): TableModel {
  return {
    title: t("chart.angleSweep.title"),
    columns: [
      { key: "angle", label: "θ", category: "angle" },
      ...SWEEP_KEYS.map((k) => ({ key: k, label: `${k[0].toUpperCase()}${k.slice(1)}` })),
    ],
    rows: data.angle_deg.map((angle, i) => [angle, ...SWEEP_KEYS.map((k) => data[k][i])]),
  };
}

/** Long format - one row per point - since the curves have their own
 *  abscissae. */
export function carpetTable(plot: CarpetPlotDto, t: Translate): TableModel {
  return {
    title: t("carpet.title"),
    columns: [
      { key: "f0", label: "0° [%]", decimals: 0 },
      { key: "without90", label: t("carpet.csv.without90") },
      { key: "f45", label: "±45° [%]", decimals: 1 },
      { key: "value", label: plot.value },
    ],
    rows: plot.curves.flatMap((curve) =>
      curve.values.map((value, i) => [
        curve.fraction_0 * 100,
        curve.without_90 ? "×" : null,
        curve.fraction_45[i] * 100,
        value,
      ]),
    ),
  };
}

export function cutoutEdgeTable(points: readonly CutoutPointDto[], t: Translate): TableModel {
  return {
    title: t("cutout.table.title"),
    columns: [
      { key: "alpha", label: t("cutout.table.alpha"), category: "angle" },
      { key: "n_theta", label: t("cutout.series.nTheta") },
      { key: "m_theta", label: t("cutout.series.mTheta") },
      { key: "n_x", label: t("cutout.table.nx") },
      { key: "n_y", label: t("cutout.table.ny") },
      { key: "n_xy", label: t("cutout.table.nxy") },
    ],
    rows: points.map((p) => [p.alpha, p.n_theta, p.m_theta, p.n_x, p.n_y, p.n_xy]),
  };
}
