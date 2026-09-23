// The project's studies: each matrix as a table, each sweep as a table and a
// chart - computed for the report like everything else in it, or taken from
// the study page when it holds a finished run of exactly these inputs.

import { METRIC_LABEL_KEYS } from "../../failureMetric";
import { matrixTable, sweepTable } from "../../study/tables";
import { formatDuration } from "../../study/cost";
import { outputLabel, variationLabel } from "../../study/outputs";
import type { PointResult } from "../../study/evaluate";
import type { StudyDef } from "../../study/model";
import type { StudyPlan } from "../../study/plan";
import type { ReportContext } from "../context";
import type { Block } from "../model";

export interface CollectedStudy {
  study: StudyDef;
  plan: StudyPlan;
  points: (PointResult | undefined)[];
  /** Why there are no results, when there are none. */
  error?: string;
}

export function studiesSection(studies: CollectedStudy[], ctx: ReportContext): Block[] {
  const { t } = ctx;
  const blocks: Block[] = [];
  for (const { study, plan, points, error } of studies) {
    blocks.push({ t: "heading", level: 2, text: study.name });
    if (error || !plan.layout) {
      blocks.push({ t: "paragraph", text: t("report.error", { message: error ?? t("study.problem.unknownKind") }) });
      continue;
    }
    const gaps = points.filter((p) => p && !p.ok).length;
    const summary = t("report.study.summary", {
      points: plan.points.length,
      time: formatDuration(plan.cost.ms, ctx.locale),
    });
    if (plan.layout.kind === "matrix" && study.kind === "matrix") {
      blocks.push({
        t: "paragraph",
        text: `${t("study.matrix.intro")} ${t("report.study.metric", { metric: t(METRIC_LABEL_KEYS[ctx.metric]) })} ${summary}`,
      });
      blocks.push({ t: "table", table: matrixTable(study.name, plan.layout, points, ctx.metric, study.matrix.transpose, t) });
    } else if (plan.layout.kind === "sweep" && study.kind === "sweep") {
      blocks.push({ t: "paragraph", text: `${t("study.sweep.intro")} ${summary}` });
      blocks.push({ t: "table", table: sweepTable(study.name, plan.layout, points, ctx.metric, t) });
      for (const output of plan.layout.outputs) {
        blocks.push({
          t: "figure",
          caption: t("report.study.figure", {
            name: study.name,
            output: outputLabel(output, ctx.metric, t),
            x: variationLabel(plan.layout.x.variation, t),
          }),
          widthMm: 140,
          request: { kind: "sweep", layout: plan.layout, points, output, metric: ctx.metric },
        });
      }
    }
    if (gaps > 0) blocks.push({ t: "paragraph", text: t("report.study.gaps", { count: gaps }), muted: true });
  }
  return blocks;
}
