// A study's results as tables - for the clipboard, a CSV file and the report.
//
// The numbers are the core's, in the metric the screen shows (RF, IRF or
// MoS); a gap is an empty field, as everywhere else in the exports.

import type { TableModel } from "../export/table";
import { toMetric, type FailureMetric, METRIC_LABEL_KEYS } from "../failureMetric";
import { criterionName } from "../types";
import type { MessageKey, MessageParams } from "../../i18n";
import type { PointResult } from "./evaluate";
import type { MatrixAxis, MatrixLayout } from "./plan";
import type { SweepLayout } from "./sweep";
import { OUTPUT_INFO, outputLabel, outputValue, variationLabel, variationValue } from "./outputs";

type Translate = (key: MessageKey, params?: MessageParams) => string;

/** A matrix cell's value in the metric, or null for a gap or a cell not yet
 *  computed. */
export function matrixValue(
  layout: MatrixLayout,
  points: readonly (PointResult | undefined)[],
  row: number,
  col: number,
  metric: FailureMetric,
): number | null {
  const point = points[row * layout.cols.length + col];
  if (!point || !point.ok) return null;
  const rf = point.values[layout.output === "lpf" ? "lpf" : "min_rf"];
  return rf === null || rf === undefined ? null : toMetric(rf, metric);
}

/** A column or row heading: a criterion by its name, anything else by its
 *  label. */
export function axisLabel(axis: MatrixAxis, t: Translate): string {
  return axis.criterion ? criterionName(axis.criterion, t) : axis.label;
}

export function matrixTable(
  title: string,
  layout: MatrixLayout,
  points: readonly (PointResult | undefined)[],
  metric: FailureMetric,
  transpose: boolean,
  t: Translate,
): TableModel {
  const rowAxes = transpose ? layout.cols : layout.rows;
  const colAxes = transpose ? layout.rows : layout.cols;
  const metricName = t(METRIC_LABEL_KEYS[metric]);
  const corner = transpose
    ? t(layout.cols[0]?.criterion ? "study.matrix.criterion" : "study.matrix.loadCase")
    : t("study.matrix.laminate");
  return {
    title: `${title} (${metricName})`,
    columns: [
      { key: "row", label: corner },
      ...colAxes.map((axis) => ({ key: axis.id, label: axisLabel(axis, t), category: "reserveFactor" as const })),
    ],
    rows: rowAxes.map((axis, r) => [
      axisLabel(axis, t),
      ...colAxes.map((_, c) =>
        transpose ? matrixValue(layout, points, c, r, metric) : matrixValue(layout, points, r, c, metric),
      ),
    ]),
  };
}

/** A sweep as a table: one row per point, the varied inputs first. */
export function sweepTable(
  title: string,
  layout: SweepLayout,
  points: readonly (PointResult | undefined)[],
  metric: FailureMetric,
  t: Translate,
): TableModel {
  const nx = layout.x.values.length;
  const ys = layout.y ? layout.y.values : [null];
  const rows: TableModel["rows"] = [];
  ys.forEach((y, j) => {
    layout.x.values.forEach((x, i) => {
      const point = points[j * nx + i];
      rows.push([
        variationValue(layout.x.variation, x),
        ...(layout.y && y !== null ? [variationValue(layout.y.variation, y)] : []),
        ...layout.outputs.map((o) => outputValue(point, o, metric)),
        point && !point.ok ? point.reason : null,
      ]);
    });
  });
  return {
    title,
    columns: [
      { key: "x", label: variationLabel(layout.x.variation, t), decimals: 3 },
      ...(layout.y ? [{ key: "y", label: variationLabel(layout.y.variation, t), decimals: 3 }] : []),
      ...layout.outputs.map((o) => {
        const info = OUTPUT_INFO[o];
        return {
          key: o,
          label: info.category ? (info.metric ? outputLabel(o, metric, t) : t(info.labelKey)) : outputLabel(o, metric, t),
          ...(info.category ? { category: info.category } : { decimals: info.decimals }),
        };
      }),
      { key: "reason", label: t("study.gapReason") },
    ],
    rows,
  };
}
