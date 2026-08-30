import { memo, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { TriangleAlert, Check } from "lucide-react";
import { layerResultsFamily } from "../store/derivedAtoms";
import type { LayerResultDto } from "../lib/types";
import { QuantityDisplay } from "./QuantityDisplay";
import { ResponsiveTable, type ResponsiveTableColumn } from "./ResponsiveTable";
import { LayerDetailPanel } from "./LayerDetailPanel";
import { failureModeLabel, useLocale, useT } from "../i18n";

// See AbdMatrixPanel.tsx for why memo() is required here.
export const LayerResultsPanel = memo(function LayerResultsPanel({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const layerResults = useAtomValue(layerResultsFamily(laminateId));
  // Which ply's failure body is open, as an index into layerResults. Clicking
  // a ply is how the Java original opened its 3D views too; here the detail
  // appears under the table rather than in a separate window.
  const [selected, setSelected] = useState<number | null>(null);

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
        numeric: true,
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
        numeric: true,
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
      <h3>{t("layerResults.title")}</h3>
      <ResponsiveTable
        variant="records"
        className="layer-results-table selectable-rows"
        columns={columns}
        rows={layerResults}
        rowKey={(l) => l.layer_number}
        rowClassName={(l) =>
          [l.failed ? "failed" : null, layerResults.indexOf(l) === selected ? "selected" : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onRowClick={(l) => {
          const index = layerResults.indexOf(l);
          setSelected((current) => (current === index ? null : index));
        }}
      />
      <p className="hint">{t("layerResults.clickHint")}</p>
      {selected !== null && selected < layerResults.length && (
        <LayerDetailPanel
          laminateId={laminateId}
          index={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
});
