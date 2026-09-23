// What belongs to the project rather than to one laminate: the materials,
// and the comparison of laminates and load cases side by side.

import { materialsTable } from "../../tables";
import type { TableModel } from "../../export/table";
import { criticalLayerIndex, governingSurface, METRIC_LABEL_KEYS, toMetric } from "../../failureMetric";
import type { ReportContext } from "../context";
import type { CollectedResults } from "../collect";
import type { Block } from "../model";

export function materialsSection(collected: CollectedResults, ctx: ReportContext): Block[] {
  if (collected.materials.length === 0) return [];
  return [
    { t: "table", table: materialsTable(collected.materials, ctx.t) },
    { t: "paragraph", text: ctx.t("report.materials.hint"), muted: true },
  ];
}

/** The comparison page's key figures, one row per column of the page. */
export function comparisonSection(collected: CollectedResults, ctx: ReportContext): Block[] {
  const { t } = ctx;
  if (collected.comparison.length === 0) return [];
  const table: TableModel = {
    title: t("compare.title"),
    columns: [
      { key: "laminate", label: t("report.compare.laminate") },
      { key: "loadCase", label: t("report.loadCase.name") },
      { key: "tges", label: "tges", category: "thickness" },
      { key: "ex", label: "Ex", category: "stiffness" },
      { key: "ey", label: "Ey", category: "stiffness" },
      { key: "g", label: "Gxy", category: "stiffness" },
      { key: "nu", label: "νxy", category: "poissonRatio" },
      { key: "rf", label: t(METRIC_LABEL_KEYS[ctx.metric]), category: "reserveFactor" },
      { key: "ply", label: t("layerResults.critical") },
    ],
    rows: collected.comparison.map((c) => {
      if (!c.clt) return [c.laminateName, c.loadCaseName, null, null, null, null, null, null, null];
      const ec = c.clt.engineering_constants;
      const critical = criticalLayerIndex(c.clt.layer_results);
      const governing = critical >= 0 ? governingSurface(c.clt.layer_results[critical]) : null;
      return [
        c.laminateName,
        c.loadCaseName,
        c.clt.tges,
        ec.ex_simple,
        ec.ey_simple,
        ec.g_simple,
        ec.nuxy_simple,
        governing ? toMetric(governing.rf.minimal_reserve_factor, ctx.metric) : null,
        critical >= 0 ? String(c.clt.layer_results[critical].layer_number) : null,
      ];
    }),
  };
  return [{ t: "table", table }];
}
