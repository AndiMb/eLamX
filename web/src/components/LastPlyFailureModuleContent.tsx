import { useMemo } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Info, TriangleAlert } from "lucide-react";
import {
  lastPlyFailureErrorFamily,
  lastPlyFailureInputFamily,
  lastPlyFailurePathFamily,
  lastPlyFailureSummaryFamily,
  loadableLastPlyFailureFamily,
} from "../store/lastPlyFailureAtoms";
import { DOF_NAMES, LOAD_FIELDS } from "../lib/constants";
import type { FailureType, LastPlyFailureInputDto } from "../lib/types";
import { Quantity } from "./Quantity";
import { QuantityDisplay } from "./QuantityDisplay";
import { SafeNumberInput } from "./SafeNumberInput";
import { BackLink } from "./BackLink";
import { Sym } from "./Sym";
import { ResponsiveTable, type ResponsiveTableColumn } from "./ResponsiveTable";
import { HowWasThisComputed } from "./HowWasThisComputed";
import { formatSignificant, NO_VALUE } from "../lib/numberFormat";
import { failureModeLabel, useLocale, useT, type MessageKey } from "../i18n";

const FAILURE_TYPE_KEYS: Record<FailureType, MessageKey> = {
  FiberFailure: "lpf.type.ff",
  MatrixFailure: "lpf.type.iff",
  GeneralMaterialFailure: "lpf.type.gmf",
  Undamaged: "lpf.type.none",
};

/** One row of the degradation path, as lastPlyFailurePathFamily builds it. */
interface PathRow {
  index: number;
  layerNumber: number;
  reserveFactor: number;
  failureName: string;
  failureType: FailureType;
  matrixFailedCount: number;
  fibreFailedCount: number;
  plyCount: number;
}

// The content behind the "lastPlyFailure" entry in MODULE_REGISTRY: how far
// past its first failed ply the laminate carries the load.
//
// Unlike the layer-by-layer analysis, the load here is a magnitude AND a
// direction: every reserve factor reported is a multiple of exactly this load,
// and the degradation path depends on which ply fails first, so scaling the
// load does not simply scale the answer once several plies have failed.
export function LastPlyFailureModuleContent({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const [input, setInput] = useAtom(lastPlyFailureInputFamily(laminateId));
  const summary = useAtomValue(lastPlyFailureSummaryFamily(laminateId));
  const path = useAtomValue(lastPlyFailurePathFamily(laminateId));
  const error = useAtomValue(lastPlyFailureErrorFamily(laminateId));
  const loadableState = useAtomValue(loadableLastPlyFailureFamily(laminateId));

  const update = <K extends keyof LastPlyFailureInputDto>(
    key: K,
    value: LastPlyFailureInputDto[K],
  ) => setInput((c) => ({ ...c, [key]: value }));

  const updateLoad = (field: (typeof LOAD_FIELDS)[number], value: number) =>
    setInput((c) => ({ ...c, loads: { ...c.loads, [field]: value } }));

  const columns = useMemo<ResponsiveTableColumn<PathRow>[]>(
    () => [
      { key: "step", label: t("lpf.path.column.step"), render: (r) => r.index },
      { key: "layer", label: t("lpf.path.column.layer"), render: (r) => r.layerNumber },
      {
        key: "type",
        label: t("lpf.path.column.type"),
        // "Undamaged" is a real outcome here, not a placeholder: under a load
        // no criterion reacts to, every step reports it and nothing is
        // degraded - so it must not be dressed up as an inter-fibre failure.
        render: (r) => (
          <span className={`chip${r.failureType === "FiberFailure" ? " danger" : ""}`}>
            {t(FAILURE_TYPE_KEYS[r.failureType])}
          </span>
        ),
      },
      {
        key: "mode",
        label: t("lpf.path.column.mode"),
        render: (r) => failureModeLabel(locale, r.failureName) || "–",
      },
      {
        key: "rf",
        label: t("lpf.path.column.rf"),
        render: (r) => <QuantityDisplay category="reserveFactor" value={r.reserveFactor} />,
      },
      {
        key: "damage",
        label: t("lpf.path.column.damage"),
        render: (r) =>
          t("lpf.path.damage", {
            iff: r.matrixFailedCount,
            ff: r.fibreFailedCount,
            total: r.plyCount,
          }),
      },
    ],
    [t, locale],
  );

  const tile = (labelKey: MessageKey, event: { reserve_factor: number } | null) => (
    <div className="stat-tile">
      <span className="label">{t(labelKey)}</span>
      <span className="value">
        {event ? (
          <QuantityDisplay category="reserveFactor" value={event.reserve_factor} />
        ) : (
          NO_VALUE
        )}
      </span>
    </div>
  );

  return (
    <>
      <BackLink to={`/laminates/${laminateId}`} label={t("nav.laminate")} />
      <p className="hint">{t("lpf.intro")}</p>

      {/* Input left and standing, results right and scrolling, from 1024 px
          up - see .module-split in App.css. */}
      <div className="module-split">
      <section className="panel module-input">
        <h2>{t("lpf.input.title")}</h2>

        <h3>{t("lpf.loads")}</h3>
        <p className="hint">{t("lpf.loads.hint")}</p>
        <div className="field-grid">
          {LOAD_FIELDS.map((field, i) => (
            <label key={field}>
              <span className="field-label">
                <Sym {...DOF_NAMES[i].load} />
              </span>
              {/* Plain number inputs, as in the CLT equation panel: the six
                  degrees of freedom mix force flows (N/mm) with moment flows
                  (N·mm/mm), so no single unit category fits them all. */}
              <SafeNumberInput
                value={input.loads[field]}
                onChange={(v) => updateLoad(field, v)}
              />
            </label>
          ))}
        </div>

        <h3>{t("lpf.degradation")}</h3>
        <div className="field-grid">
          <label>
            <span className="field-label">{t("lpf.degradationFactor")}</span>
            <SafeNumberInput
              value={input.degradation_factor}
              onChange={(v) => update("degradation_factor", v)}
            />
          </label>
          <label>
            <span className="field-label">
              <Sym base="ε" sub="crit" />
            </span>
            <Quantity
              category="strain"
              value={input.epsilon_crit}
              onChange={(v) => update("epsilon_crit", v)}
            />
          </label>
          <label>
            <span className="field-label">
              <Sym base="j" sub="A" />
            </span>
            <SafeNumberInput value={input.j_a} onChange={(v) => update("j_a", v)} />
          </label>
        </div>
        <div className="flags">
          <label>
            <input
              type="checkbox"
              checked={input.degrade_all_on_fibre_failure}
              onChange={(e) => update("degrade_all_on_fibre_failure", e.target.checked)}
            />
            {t("lpf.degradeAllOnFibreFailure")}
          </label>
        </div>
        <p className="hint">{t("lpf.degradation.hint")}</p>

        {/* The analysis drops parts of its own input, exactly as eLamX does.
            Saying so here is cheaper than letting someone hunt for why a
            changed Puck parameter moves nothing. */}
        <p className="hint">
          <Info size={14} /> {t("lpf.ignores")}
        </p>
      </section>

      <div className="module-results">
      {error && <p className="error">{t("lpf.error", { message: error })}</p>}
      {loadableState.state === "loading" && <p className="hint">{t("results.computing")}</p>}

      {summary && (
        <section className="panel">
          <h2>{t("lpf.result.title")}</h2>

          <div className="stat-tiles">
            {tile("lpf.rfIff", summary.firstMatrixFailure)}
            {tile("lpf.rfFf", summary.firstFibreFailure)}
            {tile("lpf.rfEpsilon", summary.firstEpsilon)}
            {tile("lpf.efLpf", summary.exceedanceFactor)}
          </div>

          {summary.fibreBeforeMatrixFailure && (
            <p className="hint">
              <TriangleAlert size={14} /> {t("lpf.fibreBeforeMatrix")}
            </p>
          )}
          {summary.firstMatrixFailure == null && summary.firstFibreFailure == null && (
            <p className="hint">{t("lpf.noFailure")}</p>
          )}

          <HowWasThisComputed
            title={t("lpf.how.title")}
            formula={"E_{\\perp} \\leftarrow \\eta\\,E_{\\perp}, \\quad G_{\\perp\\parallel} \\leftarrow \\eta\\,G_{\\perp\\parallel}"}
            substituted={`\\eta = ${formatSignificant(input.degradation_factor, 6, locale)}`}
          >
            <p className="hint">{t("lpf.how.hint", { steps: summary.steps })}</p>
          </HowWasThisComputed>
        </section>
      )}

      {path && path.length > 0 && (
        <section className="panel">
          <h2>{t("lpf.path.title")}</h2>
          <ResponsiveTable
            variant="records"
            columns={columns}
            rows={path}
            rowKey={(r) => r.index}
          />
          <p className="hint">{t("lpf.path.hint")}</p>
        </section>
      )}
      </div>
      </div>
    </>
  );
}
