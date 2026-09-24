// The report's figures, drawn by the app's own chart views (P3.6).
//
// A figure request names a view and its data. Here each one is mounted,
// alone, into a host far off screen - with the light palette and the light
// theme's tokens, since paper is always light (N9) - taken out as standalone
// SVG through the same function the export menu uses, and unmounted again. So
// the report's charts are the screen's charts, drawn for a laminate or a load
// case nobody needs to have open. The canvas views - the plate and the
// failure body - are drawn to PNG instead, by bitmaps.ts.

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AbdHeatmapView } from "../../components/charts/AbdHeatmap";
import { PolarChartView } from "../../components/charts/AngleSweepChart";
import { ReserveFactorChartView } from "../../components/charts/ReserveFactorChart";
import { FailureSequenceChartView } from "../../components/charts/FailureSequenceChart";
import { ThroughThicknessSheetView } from "../../components/ThroughThicknessSheet";
import { StackVizView } from "../../components/StackViz";
import { SweepChartView } from "../../components/charts/SweepChart";
import { outputLabel, variationLabel } from "../study/outputs";
import { LIGHT_CHART_COLORS, LightChartColors } from "../chartColors";
import { standaloneSvgOf } from "../chartSnapshot";
import { METRIC_LABEL_KEYS } from "../failureMetric";
import { criterionName, type FailureType } from "../types";
import { failureModeLabel, type Locale, type MessageKey } from "../../i18n";
import type { Translate } from "../tables";
import type { Block, FigureRequest, ReportDoc, SvgFigure } from "./model";
import { drawBitmap, isBitmapRequest } from "./bitmaps";

type SvgRequest = Exclude<FigureRequest, { kind: "plate" | "failureBody" }>;

/** Width the host lays a view out at, in CSS pixels. */
const HOST_WIDTH: Record<SvgRequest["kind"], number> = {
  stack: 260,
  abdHeatmap: 320,
  polar: 460,
  reserveFactor: 640,
  sheet: 1000,
  sequence: 640,
  sweep: 640,
};

const TYPE_KEYS: Record<FailureType, MessageKey> = {
  FiberFailure: "failureType.FiberFailure",
  MatrixFailure: "failureType.MatrixFailure",
  GeneralMaterialFailure: "failureType.GeneralMaterialFailure",
  Undamaged: "failureType.Undamaged",
};

function view(request: SvgRequest, t: Translate, locale: Locale): ReactNode {
  const none = () => {};
  switch (request.kind) {
    case "stack":
      return (
        <StackVizView
          width={320}
          layers={request.layers}
          symmetric={request.symmetric}
          withMiddleLayer={request.withMiddleLayer}
          materials={request.materials}
          colorBy="angle"
          showGlyphs
          showMirror
          ariaLabel={t("report.layup.title")}
        />
      );
    case "abdHeatmap":
      return (
        <AbdHeatmapView abd={request.abd} colors={LIGHT_CHART_COLORS} locale={locale} aria={t("chart.abdHeatmap.aria")} />
      );
    case "polar":
      return <PolarChartView data={request.sweep} keys={request.keys} locale={locale} aria={t("chart.angleSweep.aria")} size={420} />;
    case "reserveFactor":
      return <ReserveFactorChartView layerResults={request.layers} metric={request.metric} locale={locale} t={t} width={600} />;
    case "sheet":
      return (
        <ThroughThicknessSheetView
          fixedWidths
          plies={request.plies}
          options={{ component: 0, system: "local", axis: "z", columns: { stack: true, strain: true, stress: true, metric: true } }}
          metric={request.metric}
          critical={request.critical}
          hoverZ={null}
          onHoverZ={none}
          locale={locale}
          labels={{
            stack: t("sheet.column.stack"),
            strain: `ε1 (${t("common.local")})`,
            stress: "σ1 [MPa]",
            metric: t(METRIC_LABEL_KEYS[request.metric]),
            z: t("sheet.zLabel"),
            aria: t("sheet.aria"),
          }}
        />
      );
    case "sequence":
      return (
        <FailureSequenceChartView
          width={600}
          plies={request.plies}
          events={request.events}
          fpf={request.fpf}
          lpf={request.lpf}
          locale={locale}
          labels={{
            aria: t("lpf.sequence.aria"),
            xAxis: t("lpf.sequence.xAxis"),
            ply: (nr, angle) => t("lpf.sequence.ply", { nr, angle }),
            fpf: t("lpf.sequence.fpf"),
            lpf: t("lpf.sequence.lpf"),
            type: (type) => t(TYPE_KEYS[type]),
            step: (nr) => t("lpf.sequence.step", { nr }),
            criterion: (id) => criterionName(id, t),
            mode: (name) => failureModeLabel(locale, name),
          }}
        />
      );
    case "sweep": {
      const { layout, output, metric } = request;
      const y = outputLabel(output, metric, t);
      return (
        <SweepChartView
          width={640}
          layout={layout}
          points={request.points}
          output={output}
          metric={metric}
          locale={locale}
          colors={LIGHT_CHART_COLORS}
          labels={{
            aria: y,
            x: variationLabel(layout.x.variation, t),
            y,
            series: (v) => (layout.y ? `${variationLabel(layout.y.variation, t).split(" [")[0]} = ${v}` : v),
            gap: t("study.gap"),
          }}
        />
      );
    }
  }
}

/** Draws one request and returns it as standalone SVG, or null when the view
 *  drew nothing. */
export function drawFigure(request: SvgRequest, t: Translate, locale: Locale): SvgFigure | null {
  const host = document.createElement("div");
  host.className = "report-figure-host export-light viz";
  host.style.cssText = `position:absolute;left:-10000px;top:0;width:${HOST_WIDTH[request.kind]}px;background:#fff`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(<LightChartColors.Provider value>{view(request, t, locale)}</LightChartColors.Provider>);
    });
    const target =
      request.kind === "sheet"
        ? host.querySelector(".tt-sheet")
        : (host.querySelector<SVGSVGElement>("svg.chart-svg") ?? host.querySelector<SVGSVGElement>("svg"));
    return target ? standaloneSvgOf(target) : null;
  } finally {
    root.unmount();
    host.remove();
  }
}

/** A figure block with its drawing filled in - or, when nothing could draw
 *  it, a line saying which figure is missing rather than a silent gap. */
async function resolveFigure(
  block: Extract<Block, { t: "figure" }>,
  request: FigureRequest,
  t: Translate,
  locale: Locale,
): Promise<Block | null> {
  if (isBitmapRequest(request)) {
    const drawn = await drawBitmap(request, t, locale);
    if (!drawn) return { t: "paragraph", muted: true, text: t("report.figure.missing", { caption: block.caption }) };
    return {
      ...block,
      png: drawn.png,
      caption: drawn.flat ? `${block.caption}. ${t("report.figure.flat")}` : block.caption,
    };
  }
  const svg = drawFigure(request, t, locale);
  return svg ? { ...block, svg } : null;
}

/**
 * Fills in every figure of the report that names a request. Yields to the
 * page between figures, so a progress bar can move.
 */
export async function resolveFigures(
  doc: ReportDoc,
  t: Translate,
  locale: Locale,
  onProgress?: (done: number, total: number) => void,
): Promise<ReportDoc> {
  const pending = doc.sections.flatMap((s) => s.blocks).filter((b) => b.t === "figure" && b.request && !b.svg && !b.png);
  let done = 0;
  const sections = [];
  for (const section of doc.sections) {
    const blocks = [];
    for (const block of section.blocks) {
      if (block.t === "figure" && block.request && !block.svg && !block.png) {
        const resolved = await resolveFigure(block, block.request, t, locale);
        done += 1;
        onProgress?.(done, pending.length);
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (resolved) blocks.push(resolved);
      } else {
        blocks.push(block);
      }
    }
    sections.push({ ...section, blocks });
  }
  return { ...doc, sections };
}
