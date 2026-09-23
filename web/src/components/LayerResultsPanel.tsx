import { memo, useMemo, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { TriangleAlert, Check, Crosshair } from "lucide-react";
import { layerResultsFamily } from "../store/derivedAtoms";
import { failureMetricAtom, layerResultsMinOnlyAtom } from "../store/settingsAtoms";
import { criterionName, type LayerResultDto, type ReserveFactorDto } from "../lib/types";
import {
  criticalLayerIndex,
  governingSurface,
  isFailing,
  METRIC_LABEL_KEYS,
  toMetric,
} from "../lib/failureMetric";
import { QuantityDisplay } from "./QuantityDisplay";
import { ResponsiveTable, type ResponsiveTableColumn } from "./ResponsiveTable";
import { LayerDetailPanel } from "./LayerDetailPanel";
import { MetricToggle } from "./MetricToggle";
import { CriterionMatrix } from "./CriterionMatrix";
import { TableActions } from "./TableActions";
import { layerResultsTable } from "../lib/tables";
import { failureModeLabel, useLocale, useT } from "../i18n";

type Row = LayerResultDto & { index: number };

// See AbdMatrixPanel.tsx for why memo() is required here.
export const LayerResultsPanel = memo(function LayerResultsPanel({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const layerResults = useAtomValue(layerResultsFamily(laminateId));
  const metric = useAtomValue(failureMetricAtom);
  const [minOnly, setMinOnly] = useAtom(layerResultsMinOnlyAtom);
  // Which ply's failure body is open, as an index into layerResults. Clicking
  // a ply is how the Java original opened its 3D views too; here the detail
  // appears under the table rather than in a separate window.
  const [selected, setSelected] = useState<number | null>(null);
  const critical = layerResults ? criticalLayerIndex(layerResults) : -1;

  // The column list depends on the language, the metric and the layout, so
  // it is built per render - memoised so ResponsiveTable is not handed a
  // fresh `columns` prop on every unrelated re-render.
  const columns = useMemo<ResponsiveTableColumn<Row>[]>(() => {
    const metricName = t(METRIC_LABEL_KEYS[metric]);
    const value = (rf: ReserveFactorDto) => {
      const shown = toMetric(rf.minimal_reserve_factor, metric);
      return (
        <span className={isFailing(shown, metric) ? "metric-value failing" : "metric-value"}>
          <QuantityDisplay category="reserveFactor" value={shown} />
        </span>
      );
    };
    const mode = (rf: ReserveFactorDto) => failureModeLabel(locale, rf.failure_name) || "–";
    const nr: ResponsiveTableColumn<Row> = {
      key: "nr",
      label: t("layers.column.nr"),
      render: (l) =>
        l.index === critical ? (
          <span className="critical-marker" title={t("layerResults.critical")}>
            <Crosshair size={13} aria-label={t("layerResults.critical")} />
            {l.layer_number}
          </span>
        ) : (
          l.layer_number
        ),
    };
    const criterion: ResponsiveTableColumn<Row> = {
      key: "criterion",
      label: t("layerResults.criterion"),
      render: (l) => {
        const surface = governingSurface(l);
        const listed = l.by_criterion.length > 0;
        return (
          <span className={listed ? "governing-criterion listed" : "governing-criterion"}>
            {criterionName(surface.criterion, t)}
          </span>
        );
      },
    };
    const status: ResponsiveTableColumn<Row> = {
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
    };
    if (minOnly) {
      return [
        nr,
        {
          key: "metric",
          label: metricName,
          numeric: true,
          render: (l) => value(governingSurface(l).rf),
        },
        {
          key: "surface",
          label: t("layerResults.surface"),
          render: (l) => t(governingSurface(l).position === "lower" ? "common.bottom" : "common.top"),
        },
        { key: "mode", label: t("layerResults.mode"), render: (l) => mode(governingSurface(l).rf) },
        criterion,
        status,
      ];
    }
    return [
      nr,
      {
        key: "rf-lower",
        label: t("layerResults.metricLower", { metric: metricName }),
        numeric: true,
        render: (l) => value(l.rr_lower),
      },
      { key: "mode-lower", label: t("layerResults.modeLower"), render: (l) => mode(l.rr_lower) },
      {
        key: "rf-upper",
        label: t("layerResults.metricUpper", { metric: metricName }),
        numeric: true,
        render: (l) => value(l.rr_upper),
      },
      { key: "mode-upper", label: t("layerResults.modeUpper"), render: (l) => mode(l.rr_upper) },
      criterion,
      status,
    ];
  }, [t, locale, metric, minOnly, critical]);

  if (!layerResults) return null;
  const rows: Row[] = layerResults.map((l, index) => ({ ...l, index }));

  return (
    <>
      <div className="results-heading">
        <h3>{t("layerResults.title")}</h3>
        <div className="results-heading-tools">
          <label className="inline-check">
            <input type="checkbox" checked={minOnly} onChange={(e) => setMinOnly(e.target.checked)} />
            {t("layerResults.minOnly")}
          </label>
          <MetricToggle />
          <TableActions
            table={() => layerResultsTable(layerResults, { metric, minOnly, t, locale })}
            name="lagenergebnisse"
          />
        </div>
      </div>
      <ResponsiveTable
        variant="records"
        className="layer-results-table selectable-rows"
        columns={columns}
        rows={rows}
        rowKey={(l) => l.layer_number}
        rowClassName={(l) =>
          [
            l.failed ? "failed" : null,
            l.index === critical ? "critical" : null,
            l.index === selected ? "selected" : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onRowClick={(l) => setSelected((current) => (current === l.index ? null : l.index))}
      />
      <p className="hint">
        <Crosshair size={12} aria-hidden="true" /> {t("layerResults.criticalHint")} {t("layerResults.clickHint")}
      </p>
      <CriterionMatrix laminateId={laminateId} />
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
