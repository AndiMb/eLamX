import { Link } from "react-router-dom";
import { useAtom, useAtomValue } from "jotai";
import { TriangleAlert } from "lucide-react";
import {
  bucklingErrorFamily,
  bucklingInputFamily,
  bucklingModeListFamily,
  bucklingSummaryFamily,
  loadableBucklingFamily,
  selectedBucklingModeFamily,
} from "../store/bucklingAtoms";
import {
  BOUNDARY_CONDITIONS,
  D_MATRIX_KINDS,
  MAX_RITZ_TERMS,
  type BoundaryConditionId,
  type BucklingInputDto,
  type DMatrixKindId,
} from "../lib/types";
import { Quantity } from "./Quantity";
import { QuantityDisplay } from "./QuantityDisplay";
import { SafeNumberInput } from "./SafeNumberInput";
import { BackLink } from "./BackLink";
import { Sym } from "./Sym";
import { BucklingShapeView } from "./charts/BucklingShapeView";
import { HowWasThisComputed } from "./HowWasThisComputed";
import { PlateCheckList } from "./PlateCheckList";
import { hasBlockingCheck, plateChecks } from "../lib/plateChecks";
import { formatFixed, formatSignificant, isFiniteResult } from "../lib/numberFormat";
import { useLocale, useT } from "../i18n";

// The content behind the "buckling" entry in MODULE_REGISTRY: stability of a
// rectangular plate cut from this laminate, under in-plane load flows.
//
// The applied load flows are a DIRECTION, not a magnitude - the result is the
// factor they have to be scaled by to buckle the plate. That is why the
// defaults are -1/0/0 (unit compression in x) rather than a realistic load:
// with a unit load the factor and the critical load flow read the same, which
// is the least confusing starting point.
export function BucklingModuleContent({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const [input, setInput] = useAtom(bucklingInputFamily(laminateId));
  const summary = useAtomValue(bucklingSummaryFamily(laminateId));
  const modes = useAtomValue(bucklingModeListFamily(laminateId));
  const error = useAtomValue(bucklingErrorFamily(laminateId));
  const loadableState = useAtomValue(loadableBucklingFamily(laminateId));
  const [selectedMode, setSelectedMode] = useAtom(selectedBucklingModeFamily(laminateId));
  // The list shortens when the term count drops, so the stored index can fall
  // past its end - see selectedBucklingModeFamily on why it is not reset.
  const activeMode = modes ? Math.min(selectedMode, modes.length - 1) : 0;
  // eLamX 3.x runs these before it computes at all; here they run on every
  // keystroke, so a blocking one has to hide the core's own message rather
  // than stand beside it - "not positive definite" is the same fact told
  // worse.
  const checks = plateChecks(input);
  const blocked = hasBlockingCheck(checks);

  const update = <K extends keyof BucklingInputDto>(key: K, value: BucklingInputDto[K]) => {
    setInput((c) => ({ ...c, [key]: value }));
  };

  const criticalFlow = (index: 0 | 1 | 2) => {
    const v = summary?.nCrit?.[index];
    return isFiniteResult(v) ? v : null;
  };

  return (
    <>
      <BackLink to={`/laminates/${laminateId}`} label={t("nav.laminate")} />
      <p className="hint">{t("buckling.intro")}</p>

      {/* Input left and standing, results right and scrolling, from 1024 px
          up - see .module-split in App.css. */}
      <div className="module-split">
      <section className="panel module-input">
        <h2>{t("buckling.input.title")}</h2>

        <h3>{t("buckling.geometry")}</h3>
        <div className="field-grid">
          <label>
            <span className="field-label">
              <Sym base="a" sub="x" />
            </span>
            <Quantity
              category="thickness"
              value={input.length}
              onChange={(v) => update("length", v)}
            />
          </label>
          <label>
            <span className="field-label">
              <Sym base="b" sub="y" />
            </span>
            <Quantity category="thickness" value={input.width} onChange={(v) => update("width", v)} />
          </label>
        </div>

        <h3>{t("buckling.loads")}</h3>
        <p className="hint">{t("buckling.loads.hint")}</p>
        <div className="field-grid">
          <label>
            <span className="field-label">
              <Sym base="n" sub="x" />
            </span>
            <SafeNumberInput value={input.n_x} onChange={(v) => update("n_x", v)} />
          </label>
          <label>
            <span className="field-label">
              <Sym base="n" sub="y" />
            </span>
            <SafeNumberInput value={input.n_y} onChange={(v) => update("n_y", v)} />
          </label>
          <label>
            <span className="field-label">
              <Sym base="n" sub="xy" />
            </span>
            <SafeNumberInput value={input.n_xy} onChange={(v) => update("n_xy", v)} />
          </label>
        </div>

        <h3>{t("buckling.boundary")}</h3>
        <p className="hint">{t("buckling.boundary.hint")}</p>
        <div className="field-grid">
          <label>
            <span className="field-label">{t("buckling.bcX")}</span>
            <select
              value={input.bc_x}
              onChange={(e) => update("bc_x", e.target.value as BoundaryConditionId)}
            >
              {BOUNDARY_CONDITIONS.map((bc) => (
                <option key={bc} value={bc}>
                  {bc} — {t(`buckling.bc.${bc}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">{t("buckling.bcY")}</span>
            <select
              value={input.bc_y}
              onChange={(e) => update("bc_y", e.target.value as BoundaryConditionId)}
            >
              {BOUNDARY_CONDITIONS.map((bc) => (
                <option key={bc} value={bc}>
                  {bc} — {t(`buckling.bc.${bc}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <h3>{t("buckling.method")}</h3>
        <div className="field-grid">
          <label>
            <span className="field-label">{t("buckling.dMatrix")}</span>
            <select
              value={input.d_matrix}
              onChange={(e) => update("d_matrix", e.target.value as DMatrixKindId)}
            >
              {D_MATRIX_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {t(k.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">
              <Sym base="m" />
            </span>
            <SafeNumberInput
              value={input.m}
              onChange={(v) => update("m", clampTerms(v))}
            />
          </label>
          <label>
            <span className="field-label">
              <Sym base="n" />
            </span>
            <SafeNumberInput
              value={input.n}
              onChange={(v) => update("n", clampTerms(v))}
            />
          </label>
        </div>
        <p className="hint">{t("buckling.terms.hint", { max: MAX_RITZ_TERMS })}</p>
      </section>

      <div className="module-results">
      <PlateCheckList checks={checks} severity="error" />
      {error && !blocked && <p className="error">{t("buckling.error", { message: error })}</p>}
      {loadableState.state === "loading" && <p className="hint">{t("results.computing")}</p>}

      {summary && (
        <section className="panel">
          <h2>{t("buckling.result.title")}</h2>

          <PlateCheckList checks={checks} severity="warning" />

          {summary.symmetryWarning && (
            <p className="hint">
              <TriangleAlert size={14} /> {t("buckling.symmetryWarning")}{" "}
              <Link to={`/laminates/${laminateId}`}>{t("buckling.symmetryWarning.link")}</Link>
            </p>
          )}

          {summary.criticalFactor == null ? (
            <p className="hint">{t("buckling.noBuckling")}</p>
          ) : (
            <>
              <div className="stat-tiles">
                <div className="stat-tile">
                  <span className="label">{t("buckling.loadFactor")}</span>
                  <span className="value">
                    <QuantityDisplay category="reserveFactor" value={summary.criticalFactor} />
                  </span>
                </div>
                {([0, 1, 2] as const).map((i) => {
                  const value = criticalFlow(i);
                  const sub = ["x", "y", "xy"][i];
                  return (
                    <div className="stat-tile" key={sub}>
                      <span className="label">
                        <Sym base="n" sub={`${sub},crit`} />
                      </span>
                      <span className="value">
                        {formatFixed(value, 3, locale)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <HowWasThisComputed
                title={t("buckling.how.title")}
                formula={"\\left(\\mathbf{K} + \\lambda\\,\\mathbf{K}_g\\right)\\mathbf{a} = \\mathbf{0}"}
                substituted={`\\lambda_{crit} = ${formatSignificant(summary.criticalFactor, 6, locale)}`}
              >
                <p className="hint">{t("buckling.how.hint", { m: input.m, n: input.n })}</p>
              </HowWasThisComputed>
            </>
          )}
        </section>
      )}

      {summary?.criticalFactor != null && (
        <section className="panel">
          <h2>{t("buckling.modes.title")}</h2>
          <div className="grid">
            <BucklingShapeView laminateId={laminateId} />
            {modes && modes.length > 1 && (
              <div className="chart">
                <p className="chart-title">{t("buckling.modes.list")}</p>
                {/* Rows double as a mode picker, so the table and the 3D
                    view's dropdown drive the same selection. */}
                <table className="chart-table selectable-rows">
                  <thead>
                    <tr>
                      <th>{t("buckling.modes.column.nr")}</th>
                      <th>{t("buckling.loadFactor")}</th>
                      <th>{t("buckling.modes.column.ratio")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modes.map((mode, i) => (
                      <tr
                        key={mode.index}
                        className={i === activeMode ? "selected" : undefined}
                        aria-selected={i === activeMode}
                        onClick={() => setSelectedMode(i)}
                      >
                        <td>{i + 1}</td>
                        <td>{formatSignificant(mode.eigenvalue, 5, locale)}</td>
                        <td>{formatFixed(mode.eigenvalue / modes[0].eigenvalue, 2, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="hint">{t("buckling.modes.list.hint")}</p>
              </div>
            )}
          </div>
        </section>
      )}
      </div>
      </div>
    </>
  );
}

// The Ritz term count is an integer in 1..MAX_RITZ_TERMS; the core rejects
// anything else outright, so the input is clamped here rather than letting a
// stray keystroke turn into a failed calculation.
function clampTerms(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_RITZ_TERMS, Math.max(1, Math.round(value)));
}
