// What the plies do under each load case, and in which order they give way.

import { criticalLayerIndex, METRIC_LABEL_KEYS, toMetric, governingSurface } from "../../failureMetric";
import { sheetPlies } from "../../throughThicknessSheet";
import { criterionName } from "../../types";
import { criterionMatrixTable, hasCriterionMatrix, layerResultsTable, lpfPathTable, type LpfPathRow } from "../../tables";
import { criterionMatrixFormula, lastPlyFailureFormula, sheetFormula } from "../../formulas";
import { formatSignificant } from "../../numberFormat";
import { derivation, quantity, type ReportContext } from "../context";
import type { LaminateResults, LoadCaseResults } from "../collect";
import type { Block } from "../model";

function caseResults(lc: LoadCaseResults, ctx: ReportContext): Block[] {
  const { t } = ctx;
  const blocks: Block[] = [{ t: "heading", level: 2, text: t("report.results.title", { loadCase: lc.loadCase.name }) }];
  if (!lc.clt) {
    blocks.push({ t: "paragraph", text: t("report.error", { message: lc.error ?? "" }) });
    return blocks;
  }
  const layers = lc.clt.layer_results;
  const critical = criticalLayerIndex(layers);
  const metricName = t(METRIC_LABEL_KEYS[ctx.metric]);
  if (critical >= 0) {
    const governing = governingSurface(layers[critical]);
    const failed = layers.filter((l) => l.failed).length;
    blocks.push({
      t: "keyValue",
      rows: [
        [
          t("report.results.governing", { metric: metricName }),
          quantity(ctx, "reserveFactor", toMetric(governing.rf.minimal_reserve_factor, ctx.metric)),
        ],
        [
          t("layerResults.critical"),
          t("report.results.criticalPly", {
            nr: layers[critical].layer_number,
            surface: t(governing.position === "lower" ? "common.bottom" : "common.top"),
            criterion: criterionName(governing.criterion, t),
          }),
        ],
        [t("report.results.failedPlies"), `${failed} / ${layers.length}`],
        [t("report.results.verdict"), t(failed > 0 ? "report.results.fails" : "report.results.holds")],
      ],
    });
  }
  blocks.push({ t: "table", table: layerResultsTable(layers, { metric: ctx.metric, minOnly: false, t, locale: ctx.locale }) });
  if (hasCriterionMatrix(layers)) {
    blocks.push({ t: "table", table: criterionMatrixTable(layers, { metric: ctx.metric, t }) });
  }
  blocks.push({
    t: "figure",
    // The chart's legend is outside its SVG on screen; here it is said in words.
    caption: `${t("report.figure.reserveFactor", { metric: metricName, loadCase: lc.loadCase.name })}. ${t("report.figure.reserveFactorLegend")}`,
    widthMm: 150,
    request: { kind: "reserveFactor", layers, metric: ctx.metric },
  });
  const plies = sheetPlies(lc.clt.layer_contributions, layers);
  blocks.push({
    t: "figure",
    caption: t("report.figure.sheet", { loadCase: lc.loadCase.name }),
    widthMm: 170,
    request: { kind: "sheet", plies, metric: ctx.metric, critical },
  });
  const example = plies[Math.max(critical, 0)];
  blocks.push(
    ...derivation(
      ctx,
      criterionMatrixFormula(layers, ctx),
      example
        ? sheetFormula(
            {
              number: example.number,
              zExample: example.zUpper,
              epsilonX0: lc.clt.strains.epsilon_x,
              kappaX: lc.clt.strains.kappa_x,
              epsilonX: example.strain.global.upper[0],
            },
            ctx,
          )
        : null,
    ),
  );
  return blocks;
}

export function layerResultsSection(results: LaminateResults, ctx: ReportContext): Block[] {
  return results.cases.flatMap((lc) => caseResults(lc, ctx));
}

export function failureSequenceSection(results: LaminateResults, ctx: ReportContext): Block[] {
  const { t, locale } = ctx;
  const outcome = results.lastPlyFailure;
  if (!outcome) return [];
  const blocks: Block[] = [{ t: "heading", level: 2, text: t("lpf.sequence.title") }];
  if ("error" in outcome) {
    blocks.push({ t: "paragraph", text: t("lpf.error", { message: outcome.error }) });
    return blocks;
  }
  const r = outcome.result;
  const load = outcome.input.loads;
  const rf = (e: { reserve_factor: number } | null) => (e ? quantity(ctx, "reserveFactor", e.reserve_factor) : "–");
  blocks.push({
    t: "keyValue",
    rows: [
      [
        t("report.lpf.load"),
        `nx = ${load.n_x}, ny = ${load.n_y}, nxy = ${load.n_xy}, mx = ${load.m_x}, my = ${load.m_y}, mxy = ${load.m_xy}`,
      ],
      [t("lpf.rfIff"), rf(r.first_matrix_failure)],
      [t("lpf.rfFf"), rf(r.first_fibre_failure)],
      [t("lpf.rfEpsilon"), rf(r.first_epsilon)],
      [t("lpf.efLpf"), rf(r.exceedance_factor)],
    ],
  });
  if (r.fibre_before_matrix_failure) blocks.push({ t: "paragraph", text: t("lpf.fibreBeforeMatrix") });
  const path: LpfPathRow[] = r.iterations.map((iteration, index) => ({
    index,
    layerNumber: iteration.layer_number,
    reserveFactor: iteration.reserve_factor,
    failureName: iteration.failure_name,
    failureType: iteration.failure_type,
    criterionId: iteration.criterion_id,
    matrixFailedCount: iteration.matrix_failed.filter(Boolean).length,
    fibreFailedCount: iteration.fibre_failed.filter(Boolean).length,
    plyCount: iteration.matrix_failed.length,
  }));
  if (path.length > 0) {
    const angles = results.base?.layer_contributions ?? [];
    blocks.push({
      t: "figure",
      caption: t("lpf.sequence.title"),
      widthMm: 165,
      request: {
        kind: "sequence",
        plies: Array.from({ length: path[0].plyCount }, (_, i) => ({
          number: i + 1,
          angle: angles.find((c) => c.layer_number === i + 1)?.angle_deg ?? 0,
        })),
        events: path.map((p) => ({
          step: p.index,
          layerNumber: p.layerNumber,
          rf: p.reserveFactor,
          type: p.failureType,
          failureName: p.failureName,
          criterion: p.criterionId,
        })),
        fpf: path[0].reserveFactor,
        lpf: r.exceedance_factor?.reserve_factor ?? null,
      },
    });
    blocks.push({ t: "table", table: lpfPathTable(path, t, locale) });
  }
  blocks.push(...derivation(ctx, lastPlyFailureFormula(outcome.input.degradation_factor, r.iterations.length, ctx)));
  blocks.push({
    t: "paragraph",
    muted: true,
    text: t("report.lpf.degradation", { eta: formatSignificant(outcome.input.degradation_factor, 6, locale) }),
  });
  return blocks;
}
