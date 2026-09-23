// The whole way from a template to a PDF, in one call - the entry of the
// report's lazy chunk. The dialog imports this with `import()`, so neither the
// builders nor jsPDF, svg2pdf and MathJax are in the bundle the app starts
// with.

import { elamx } from "../wasm";
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
}

export async function generateReport(options: GenerateOptions): Promise<Blob> {
  const { template, project, activeLoadCase, ctx, info, onProgress } = options;
  const collected = await collectResults(template, project, elamx, activeLoadCase, (done, total) =>
    onProgress?.("compute", done, total),
  );
  const doc = buildReport(template, collected, ctx, info);
  const drawn = await resolveFigures(doc, ctx.t, ctx.locale, (done, total) => onProgress?.("figures", done, total));
  return await renderReportPdf(drawn, {
    locale: ctx.locale,
    formats: ctx.formats,
    onProgress: (done, total) => onProgress?.("pdf", done, total),
  });
}
