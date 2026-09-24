import { Link } from "react-router-dom";
import { vibrationFormula, howProps } from "../lib/formulas";
import { useAtom, useAtomValue } from "jotai";
import { TriangleAlert } from "lucide-react";
import {
  loadableVibrationFamily,
  vibrationErrorFamily,
  vibrationInputFamily,
  vibrationModeListFamily,
  vibrationSummaryFamily,
} from "../store/vibrationAtoms";
import {
  BOUNDARY_CONDITIONS,
  D_MATRIX_KINDS,
  MAX_RITZ_TERMS,
  type BoundaryConditionId,
  type DMatrixKindId,
  type VibrationInputDto,
} from "../lib/types";
import { Quantity } from "./Quantity";
import { SafeNumberInput } from "./SafeNumberInput";
import { BackLink } from "./BackLink";
import { Sym } from "./Sym";
import { StiffenerPanel } from "./StiffenerPanel";
import { VibrationShapeView } from "./charts/VibrationShapeView";
import { HowWasThisComputed } from "./HowWasThisComputed";
import { PlateCheckList } from "./PlateCheckList";
import { hasBlockingCheck, plateChecks } from "../lib/plateChecks";
import { formatSignificant } from "../lib/numberFormat";
import { ResponsiveTable, type ResponsiveTableColumn } from "./ResponsiveTable";
import { Panel } from "./Panel";
import { TableActions } from "./TableActions";
import { recordsTableModel } from "../lib/export/records";
import { useLocale, useT } from "../i18n";

// Free vibration of a rectangular plate cut from this laminate.
//
// The buckling module without a load. That is not a simplification for the
// UI's sake: it is the difference between the two analyses, which otherwise
// share the stiffness matrix, the stiffeners, the edge conditions, the Ritz
// term counts and the eigensolver. What stands in the load's place is the
// laminate's mass, which comes from the ply densities - so a material without
// one makes this module, and only this module, refuse to compute.

type ModeRow = { nr: number; frequency: number; ratio: number };

export function VibrationModuleContent({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const [input, setInput] = useAtom(vibrationInputFamily(laminateId));
  const summary = useAtomValue(vibrationSummaryFamily(laminateId));
  const modes = useAtomValue(vibrationModeListFamily(laminateId));
  const error = useAtomValue(vibrationErrorFamily(laminateId));
  const loadableState = useAtomValue(loadableVibrationFamily(laminateId));

  const checks = plateChecks(input);
  const blocked = hasBlockingCheck(checks);

  const update = <K extends keyof VibrationInputDto>(key: K, value: VibrationInputDto[K]) => {
    setInput((current) => ({ ...current, [key]: value }));
  };

  const clampTerms = (value: number) =>
    Math.max(1, Math.min(MAX_RITZ_TERMS, Math.round(value)));

  const modeColumns: ResponsiveTableColumn<ModeRow>[] = [
    {
      key: "nr",
      label: t("vibration.modes.nr"),
      render: (row) => row.nr,
      value: (row) => row.nr,
      decimals: 0,
    },
    {
      key: "frequency",
      label: t("vibration.modes.frequency"),
      numeric: true,
      render: (row) => formatSignificant(row.frequency, 5, locale),
      value: (row) => row.frequency,
    },
    {
      key: "ratio",
      label: t("vibration.modes.ratio"),
      numeric: true,
      render: (row) => formatSignificant(row.ratio, 3, locale),
      value: (row) => row.ratio,
    },
  ];
  const modeRows: ModeRow[] = modes
    ? modes.map((mode, index) => ({
        nr: index + 1,
        frequency: mode.frequency,
        ratio: mode.frequency / modes[0].frequency,
      }))
    : [];

  return (
    <>
      <BackLink to={`/laminates/${laminateId}`} label={t("nav.laminate")} />
      <p className="hint">{t("vibration.intro")}</p>

      <div className="module-split">
        <section className="panel module-input">
          <h2>{t("vibration.input.title")}</h2>

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
              <Quantity
                category="thickness"
                value={input.width}
                onChange={(v) => update("width", v)}
              />
            </label>
          </div>

          <h3>{t("buckling.boundary")}</h3>
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
            <label className="wide">
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
              <SafeNumberInput value={input.m} onChange={(v) => update("m", clampTerms(v))} />
            </label>
            <label>
              <span className="field-label">
                <Sym base="n" />
              </span>
              <SafeNumberInput value={input.n} onChange={(v) => update("n", clampTerms(v))} />
            </label>
          </div>
          <p className="hint">{t("buckling.terms.hint", { max: MAX_RITZ_TERMS })}</p>

          <StiffenerPanel
            stiffeners={input.stiffeners}
            onChange={(stiffeners) => update("stiffeners", stiffeners)}
            length={input.length}
            width={input.width}
          />
          <p className="hint">{t("vibration.stiffener.mass.hint")}</p>
        </section>

        <div className="module-results">
          <PlateCheckList checks={checks} severity="error" />
          {/* The two reasons this module can refuse are worth telling apart
              in the UI too: an unsymmetric stack is not a broken input, it is
              a laminate this analysis cannot model - and the fix is one link
              away, where the D-matrix symmetry warning already points. */}
          {error && !blocked && (
            error.includes("symmetric laminate") ? (
              <p className="warning">
                <TriangleAlert size={14} /> {t("vibration.needsSymmetric")}{" "}
                <Link to={`/laminates/${laminateId}`}>{t("buckling.symmetryWarning.link")}</Link>
              </p>
            ) : (
              <p className="error">{t("vibration.error", { message: error })}</p>
            )
          )}
          {loadableState.state === "loading" && <p className="hint">{t("results.computing")}</p>}

          {summary && (
            <section className="panel">
              <h2>{t("vibration.result.title")}</h2>

              <PlateCheckList checks={checks} severity="warning" />

              {summary.symmetryWarning && (
                <p className="warning">
                  <TriangleAlert size={14} /> {t("buckling.symmetryWarning")}{" "}
                  <Link to={`/laminates/${laminateId}`}>{t("buckling.symmetryWarning.link")}</Link>
                </p>
              )}

              <div className="stat-tiles">
                <div className="stat-tile">
                  <span className="label">{t("vibration.fundamental")}</span>
                  <span className="value">
                    {formatSignificant(summary.fundamentalFrequency, 5, locale)}
                    <span className="quantity-unit"> Hz</span>
                  </span>
                </div>
              </div>

              <HowWasThisComputed
                {...howProps(vibrationFormula(summary.fundamentalFrequency, { m: input.m, n: input.n }, { t, locale }))}
              >
                <p className="hint">{t("vibration.how.hint", { m: input.m, n: input.n })}</p>
              </HowWasThisComputed>
            </section>
          )}

          {/* The shape and the list of modes in one card, side by side - the
              layout the buckling page has for the same pair. As two cards,
              the second a full width for three narrow columns, they read as
              two unrelated results. */}
          {modes && modes.length > 0 && (
            <Panel
              title={t("vibration.shape.title")}
              tools={
                modes.length > 1 && (
                  <TableActions
                    table={() => recordsTableModel(t("vibration.modes.title"), modeColumns, modeRows)}
                    name="eigenfrequenzen"
                  />
                )
              }
            >
              <div className="grid shape-and-list">
                <VibrationShapeView laminateId={laminateId} />
                {modes.length > 1 && (
                  <div className="chart">
                    <p className="chart-title">{t("vibration.modes.title")}</p>
                    <ResponsiveTable variant="records" columns={modeColumns} rows={modeRows} rowKey={(row) => row.nr} />
                    <p className="hint">{t("vibration.modes.hint")}</p>
                  </div>
                )}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
