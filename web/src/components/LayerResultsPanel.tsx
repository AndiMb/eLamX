import { memo } from "react";
import { useAtomValue } from "jotai";
import { TriangleAlert, Check } from "lucide-react";
import { layerResultsFamily } from "../store/derivedAtoms";
import type { LayerResultDto } from "../lib/types";
import { useRenderCount } from "../lib/useRenderCount";
import { QuantityDisplay } from "./QuantityDisplay";
import { ResponsiveTable, type ResponsiveTableColumn } from "./ResponsiveTable";

const COLUMNS: ResponsiveTableColumn<LayerResultDto>[] = [
  { key: "nr", label: "Nr.", render: (l) => l.layer_number },
  {
    key: "rf-unten",
    label: "RF unten",
    render: (l) => <QuantityDisplay category="reserveFactor" value={l.rr_lower.minimal_reserve_factor} />,
  },
  { key: "modus-unten", label: "Modus unten", render: (l) => l.rr_lower.failure_name || "–" },
  {
    key: "rf-oben",
    label: "RF oben",
    render: (l) => <QuantityDisplay category="reserveFactor" value={l.rr_upper.minimal_reserve_factor} />,
  },
  { key: "modus-oben", label: "Modus oben", render: (l) => l.rr_upper.failure_name || "–" },
  {
    key: "status",
    label: "Status",
    render: (l) =>
      l.failed ? (
        <span className="chip danger">
          <TriangleAlert size={12} /> versagt
        </span>
      ) : (
        <span className="chip ok">
          <Check size={12} /> bestanden
        </span>
      ),
  },
];

// See AbdMatrixPanel.tsx for why memo() is required here.
export const LayerResultsPanel = memo(function LayerResultsPanel({ laminateId }: { laminateId: string }) {
  const layerResults = useAtomValue(layerResultsFamily(laminateId));
  const renderCount = useRenderCount();

  if (!layerResults) return null;

  return (
    <>
      <h3>
        Lagenergebnisse <span className="render-count">(Renders: {renderCount})</span>
      </h3>
      <ResponsiveTable
        variant="records"
        className="layer-results-table"
        columns={COLUMNS}
        rows={layerResults}
        rowKey={(l) => l.layer_number}
        rowClassName={(l) => (l.failed ? "failed" : undefined)}
      />
    </>
  );
});
