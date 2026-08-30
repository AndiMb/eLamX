import { useMemo, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { TriangleAlert } from "lucide-react";
import {
  loadablePressureVesselFamily,
  pressureVesselErrorFamily,
  pressureVesselInputFamily,
  pressureVesselLayersFamily,
  pressureVesselSummaryFamily,
} from "../store/pressureVesselAtoms";
import { RADIUS_TYPES, type LayerResultDto, type PressureVesselInputDto, type RadiusTypeId } from "../lib/types";
import { formatScientific, NO_VALUE } from "../lib/numberFormat";
import { Quantity } from "./Quantity";
import { QuantityDisplay } from "./QuantityDisplay";
import { SafeNumberInput } from "./SafeNumberInput";
import { BackLink } from "./BackLink";
import { Sym } from "./Sym";
import { ResponsiveTable, type ResponsiveTableColumn } from "./ResponsiveTable";
import { HowWasThisComputed } from "./HowWasThisComputed";
import { failureModeLabel, useLocale, useT } from "../i18n";

// The content behind the "pressureVessel" entry in MODULE_REGISTRY: a
// thin-walled cylinder wound from this laminate.
//
// Two things make it a module of its own rather than a CLT load case. The load
// is not given but derived - the boiler formula on the mean radius, hoop twice
// axial - and the wall is held straight rather than moment-free, so the
// analysis reports the moments that constraint takes. On top of that the hoop
// strain follows 1/r through the wall, which is the one place a vessel is not
// a flat laminate.
export function PressureVesselModuleContent({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const [input, setInput] = useAtom(pressureVesselInputFamily(laminateId));
  const summary = useAtomValue(pressureVesselSummaryFamily(laminateId));
  const layers = useAtomValue(pressureVesselLayersFamily(laminateId));
  const error = useAtomValue(pressureVesselErrorFamily(laminateId));
  const loadableState = useAtomValue(loadablePressureVesselFamily(laminateId));

  // Geometry the vessel's own numbers say nothing about, kept local: they
  // scale a strain into a displacement and belong to the question being asked,
  // not to the laminate.
  const [length, setLength] = useState(1000);
  const [diameter, setDiameter] = useState(400);

  const update = <K extends keyof PressureVesselInputDto>(
    key: K,
    value: PressureVesselInputDto[K],
  ) => setInput((c) => ({ ...c, [key]: value }));

  const columns = useMemo<ResponsiveTableColumn<LayerResultDto>[]>(
    () => [
      { key: "nr", label: t("layers.column.nr"), render: (l) => l.layer_number },
      {
        key: "s11",
        label: "σ∥",
        render: (l) => formatScientific(l.sss_lower.stress[0], 3, locale),
      },
      {
        key: "s22",
        label: "σ⊥",
        render: (l) => formatScientific(l.sss_lower.stress[1], 3, locale),
      },
      {
        key: "rf",
        label: t("layerDetail.rf"),
        render: (l) => (
          <QuantityDisplay
            category="reserveFactor"
            value={Math.min(
              l.rr_lower.minimal_reserve_factor,
              l.rr_upper.minimal_reserve_factor,
            )}
          />
        ),
      },
      {
        key: "mode",
        label: t("layerResults.modeLower"),
        render: (l) =>
          failureModeLabel(
            locale,
            l.rr_lower.minimal_reserve_factor <= l.rr_upper.minimal_reserve_factor
              ? l.rr_lower.failure_name
              : l.rr_upper.failure_name,
          ) || "–",
      },
    ],
    [t, locale],
  );

  return (
    <>
      <BackLink to={`/laminates/${laminateId}`} label={t("nav.laminate")} />
      <p className="hint">{t("vessel.intro")}</p>

      <div className="module-split">
        <section className="panel module-input">
          <h2>{t("vessel.input.title")}</h2>

          <div className="field-grid">
            <label>
              <span className="field-label">{t("vessel.pressure")}</span>
              <Quantity
                category="stress"
                value={input.pressure}
                onChange={(v) => update("pressure", v)}
              />
            </label>
            <label>
              <span className="field-label">
                <Sym base="r" />
              </span>
              <Quantity
                category="thickness"
                value={input.radius}
                onChange={(v) => update("radius", v)}
              />
            </label>
            <label>
              <span className="field-label">{t("vessel.radiusType")}</span>
              <select
                value={input.radius_type}
                onChange={(e) => update("radius_type", e.target.value as RadiusTypeId)}
              >
                {RADIUS_TYPES.map((type) => (
                  <option key={type.id} value={type.id}>
                    {t(type.labelKey)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="hint">{t("vessel.radiusType.hint")}</p>

          <h3>{t("vessel.geometry")}</h3>
          <p className="hint">{t("vessel.geometry.hint")}</p>
          <div className="field-grid">
            <label>
              <span className="field-label">{t("vessel.length")}</span>
              <SafeNumberInput value={length} onChange={setLength} />
            </label>
            <label>
              <span className="field-label">{t("vessel.diameter")}</span>
              <SafeNumberInput value={diameter} onChange={setDiameter} />
            </label>
          </div>
        </section>

        <div className="module-results">
          {error && <p className="error">{t("vessel.error", { message: error })}</p>}
          {loadableState.state === "loading" && <p className="hint">{t("results.computing")}</p>}

          {summary && (
            <section className="panel">
              <h2>{t("vessel.result.title")}</h2>

              <div className="stat-tiles">
                <div className="stat-tile">
                  <span className="label">
                    <Sym base="n" sub="x" /> ({t("vessel.axial")})
                  </span>
                  <span className="value">{formatScientific(summary.axialFlow, 3, locale)}</span>
                </div>
                <div className="stat-tile">
                  <span className="label">
                    <Sym base="n" sub="y" /> ({t("vessel.hoop")})
                  </span>
                  <span className="value">{formatScientific(summary.hoopFlow, 3, locale)}</span>
                </div>
                <div className="stat-tile">
                  <span className="label">{t("vessel.minRf")}</span>
                  <span className="value">
                    <QuantityDisplay category="reserveFactor" value={summary.minReserveFactor} />
                  </span>
                </div>
                <div className="stat-tile">
                  <span className="label">{t("vessel.failedPlies")}</span>
                  <span className="value">
                    {summary.failedPlies} / {summary.plies}
                  </span>
                </div>
              </div>

              {summary.minReserveFactor < 1 && (
                <p className="hint">
                  <TriangleAlert size={14} /> {t("vessel.fails")}
                </p>
              )}

              <h3>{t("vessel.deformation")}</h3>
              <div className="stat-tiles">
                <div className="stat-tile">
                  <span className="label">
                    <Sym base="ε" sub="x" />
                  </span>
                  <span className="value">{formatScientific(summary.axialStrain, 3, locale)}</span>
                </div>
                <div className="stat-tile">
                  <span className="label">
                    <Sym base="ε" sub="u" />
                  </span>
                  <span className="value">{formatScientific(summary.hoopStrain, 3, locale)}</span>
                </div>
                <div className="stat-tile">
                  <span className="label">{t("vessel.deltaLength")}</span>
                  <span className="value">
                    <QuantityDisplay
                      category="thickness"
                      value={summary.axialStrain * length}
                    />
                  </span>
                </div>
                <div className="stat-tile">
                  <span className="label">{t("vessel.deltaDiameter")}</span>
                  <span className="value">
                    <QuantityDisplay
                      category="thickness"
                      value={summary.hoopStrain * diameter}
                    />
                  </span>
                </div>
              </div>

              <HowWasThisComputed
                title={t("vessel.how.title")}
                formula={"n_x = \\dfrac{p\\,r}{2}, \\quad n_u = p\\,r, \\quad \\kappa = 0"}
                substituted={`r = ${formatScientific(summary.meanRadius, 4, locale)}`}
              >
                <p className="hint">{t("vessel.how.hint")}</p>
              </HowWasThisComputed>
            </section>
          )}

          {layers && layers.length > 0 && (
            <section className="panel">
              <h2>{t("vessel.layers.title")}</h2>
              <ResponsiveTable
                variant="records"
                className="layer-results-table"
                columns={columns}
                rows={layers}
                rowKey={(l) => l.layer_number}
                rowClassName={(l) => (l.failed ? "failed" : undefined)}
              />
              <p className="hint">{t("vessel.layers.hint")}</p>
            </section>
          )}

          {!summary && !error && loadableState.state !== "loading" && (
            <p className="hint">{NO_VALUE}</p>
          )}
        </div>
      </div>
    </>
  );
}
