// The laminate itself: its stack, its stiffness, its load cases.

import { shortStackNotation } from "../../angleStack";
import { criterionName } from "../../types";
import { abdTable, engineeringConstantsTable, expansionTable, layupTable, loadCasesTable } from "../../tables";
import { aMatrixFormula, exFormula, localQFormula, nuxyFormula, qBarFormula } from "../../formulas";
import { derivation, quantity, type ReportContext } from "../context";
import type { LaminateResults } from "../collect";
import type { Block } from "../model";
import type { MaterialDto } from "../../types";

/** The laminate in the notation of a drawing (O9): condensed, `[0₂/±45]s`. */
export function laminateNotation(results: LaminateResults): string {
  const { config } = results;
  return shortStackNotation(
    config.layers.map((l) => l.angle),
    config.symmetric,
    config.withMiddleLayer,
  );
}

/** Every criterion the laminate's plies are checked against, in order. */
export function laminateCriteria(results: LaminateResults, ctx: ReportContext): string[] {
  const ids: string[] = [];
  for (const layer of results.config.layers) {
    for (const id of [layer.criterionId, ...(layer.extraCriteria ?? [])]) if (!ids.includes(id)) ids.push(id);
  }
  return ids.map((id) => criterionName(id, ctx.t));
}

export function laminateSection(results: LaminateResults, materials: MaterialDto[], ctx: ReportContext): Block[] {
  const { t } = ctx;
  const { config, base } = results;
  const rows: [string, string][] = [
    [t("report.laminate.notation"), laminateNotation(results)],
    [t("report.laminate.plies"), String(base?.layer_results.length ?? config.layers.length)],
  ];
  if (base) {
    rows.push(
      [t("report.laminate.thickness"), quantity(ctx, "thickness", base.tges)],
      [t("summary.symmetric"), t(base.is_symmetric ? "common.yes" : "common.no")],
      [t("summary.areaWeight"), quantity(ctx, "arealMass", base.area_weight)],
    );
  }
  rows.push([t("report.laminate.criteria"), laminateCriteria(results, ctx).join(", ")]);
  const blocks: Block[] = [
    { t: "heading", level: 2, text: t("report.layup.title") },
    { t: "keyValue", rows },
    { t: "table", table: layupTable(config, materials, t) },
  ];
  if (config.symmetric) blocks.push({ t: "paragraph", text: t("report.layup.symmetricNote"), muted: true });
  blocks.push({
    t: "figure",
    caption: t("report.figure.stack", { name: config.name }),
    widthMm: 70,
    request: {
      kind: "stack",
      layers: config.layers,
      symmetric: config.symmetric,
      withMiddleLayer: config.withMiddleLayer,
      materials: materials.map((m) => ({ id: m.id, name: m.name })),
    },
  });
  return blocks;
}

export function abdSection(results: LaminateResults, materials: MaterialDto[], ctx: ReportContext): Block[] {
  const { t } = ctx;
  const base = results.base;
  if (!base) return [];
  const blocks: Block[] = [
    { t: "heading", level: 2, text: t("report.section.abd") },
    { t: "table", table: abdTable(base.abd, t) },
    {
      t: "figure",
      caption: t("chart.abdHeatmap.title"),
      widthMm: 70,
      request: { kind: "abdHeatmap", abd: base.abd },
    },
    { t: "table", table: engineeringConstantsTable(base.engineering_constants, t) },
    { t: "table", table: expansionTable(base.alpha_global, base.beta_global, t) },
  ];
  if (results.sweep) {
    blocks.push({
      t: "figure",
      caption: t("chart.angleSweep.title"),
      widthMm: 105,
      request: { kind: "polar", sweep: results.sweep, keys: ["a11", "a12", "a22", "a66"] },
    });
  }
  const first = base.layer_contributions[0];
  const material = materials.find((m) => m.id === first?.material_id);
  blocks.push(
    ...derivation(
      ctx,
      material ? localQFormula(material, ctx) : null,
      material && first ? qBarFormula(first, material, ctx) : null,
      aMatrixFormula(base.layer_contributions, base.abd, ctx, 8),
      exFormula(base.abd_inv, base.tges, base.engineering_constants, ctx),
      nuxyFormula(base.abd_inv, base.engineering_constants, ctx),
    ),
  );
  return blocks;
}

export function loadCasesSection(results: LaminateResults, ctx: ReportContext): Block[] {
  const { t } = ctx;
  return [
    { t: "heading", level: 2, text: t("report.section.loadCases") },
    { t: "table", table: loadCasesTable(results.cases.map((c) => c.loadCase), t) },
    { t: "paragraph", text: t("report.loadCases.hint"), muted: true },
  ];
}
