// The whole way from a template to a PDF, in one call - the entry of the
// report's lazy chunk. The dialog imports this with `import()`, so neither the
// builders nor jsPDF, svg2pdf and MathJax are in the bundle the app starts
// with.

import { elamx } from "../wasm";
import { batchClient } from "../batchClient";
import { planStudy } from "../study/plan";
import type { PointResult } from "../study/evaluate";
import type { StudyRunner } from "./collect";
import { planMessages } from "../../store/studyRunAtoms";
import { buildReport, type ReportInfo } from "./build";
import { collectResults, type ReportProject } from "./collect";
import type { ReportContext } from "./context";
import { resolveFigures } from "./figures";
import type { ReportTemplate } from "./model";
import { renderReportPdf } from "./pdf";

export type ReportStage = "compute" | "figures" | "pdf";

export interface GenerateOptions {
  template: ReportTemplate;
  project: ReportProject;
  /** Each laminate's active load case. */
  activeLoadCase: (laminateId: string) => string | undefined;
  ctx: ReportContext;
  info: ReportInfo;
  onProgress?: (stage: ReportStage, done: number, total: number) => void;
  /** A finished run of a study's current inputs, if the page holds one -
   *  the report takes it rather than computing the study again. */
  cachedStudy?: (id: string, hash: string) => (PointResult | undefined)[] | null;
}

export async function generateReport(options: GenerateOptions): Promise<Blob> {
  const { template, project, activeLoadCase, ctx, info, onProgress, cachedStudy } = options;
  const studies: StudyRunner = {
    plan: (study) => planStudy(study, project, planMessages(ctx.t)),
    run: async (study, plan) => {
      const cached = cachedStudy?.(study.id, plan.hash);
      if (cached) return cached;
      const points: (PointResult | undefined)[] = new Array(plan.points.length);
      await batchClient.run({ kind: "points", points: plan.points }, { onPoint: (i, v) => (points[i] = v) }).promise;
      return points;
    },
  };
  const collected = await collectResults(
    template,
    project,
    elamx,
    activeLoadCase,
    (done, total) => onProgress?.("compute", done, total),
    studies,
  );
  const doc = buildReport(template, collected, ctx, info);
  const drawn = await resolveFigures(doc, ctx.t, ctx.locale, (done, total) => onProgress?.("figures", done, total));
  return await renderReportPdf(drawn, {
    locale: ctx.locale,
    formats: ctx.formats,
    onProgress: (done, total) => onProgress?.("pdf", done, total),
  });
}
