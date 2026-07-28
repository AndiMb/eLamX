import { memo, useMemo } from "react";
import { useAtomValue } from "jotai";
import { TriangleAlert, Check } from "lucide-react";
import { layerResultsFamily } from "../store/derivedAtoms";
import type { LayerResultDto } from "../lib/types";
import { useRenderCount } from "../lib/useRenderCount";
import { QuantityDisplay } from "./QuantityDisplay";
import { ResponsiveTable, type ResponsiveTableColumn } from "./ResponsiveTable";
import { failureModeLabel, useLocale, useT } from "../i18n";

// See AbdMatrixPanel.tsx for why memo() is required here.
export const LayerResultsPanel = memo(function LayerResultsPanel({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const layerResults = useAtomValue(layerResultsFamily(laminateId));
  const renderCount = useRenderCount();

  // The column list used to be a module-level constant; it has to be built
  // per render now that its labels depend on the language. useMemo keeps the
  // array reference stable between language changes, so ResponsiveTable is
  // not handed a fresh `columns` prop on every unrelated re-render.
  const columns = useMemo<ResponsiveTableColumn<LayerResultDto>[]>(
    () => [
      { key: "nr", label: t("layers.column.nr"), render: (l) => l.layer_number },
      {
        key: "rf-lower",
        label: t("layerResults.rfLower"),
        render: (l) => <QuantityDisplay category="reserveFactor" value={l.rr_lower.minimal_reserve_factor} />,
      },
      {
        key: "mode-lower",
        label: t("layerResults.modeLower"),
        render: (l) => failureModeLabel(locale, l.rr_lower.failure_name) || "–",
      },
      {
        key: "rf-upper",
        label: t("layerResults.rfUpper"),
        render: (l) => <QuantityDisplay category="reserveFactor" value={l.rr_upper.minimal_reserve_factor} />,
      },
      {
        key: "mode-upper",
        label: t("layerResults.modeUpper"),
        render: (l) => failureModeLabel(locale, l.rr_upper.failure_name) || "–",
      },
      {
        key: "status",
        label: t("layerResults.status"),
        render: (l) =>
          l.failed ? (
            <span className="chip danger">
              <TriangleAlert size={12} /> {t("layerResults.failed")}
            </span>
          ) : (
            <span className="chip ok">
              <Check size={12} /> {t("layerResults.passed")}
            </span>
          ),
      },
    ],
    [t, locale],
  );

  if (!layerResults) return null;

  return (
    <>
      <h3>
        {t("layerResults.title")} <span className="render-count">{t("common.renders", { count: renderCount })}</span>
      </h3>
      <ResponsiveTable
        variant="records"
        className="layer-results-table"
        columns={columns}
        rows={layerResults}
        rowKey={(l) => l.layer_number}
        rowClassName={(l) => (l.failed ? "failed" : undefined)}
      />
    </>
  );
});
