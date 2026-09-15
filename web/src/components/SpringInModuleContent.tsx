import { Link } from "react-router-dom";
import { useAtom, useAtomValue } from "jotai";
import { TriangleAlert } from "lucide-react";
import {
  loadableSpringInFamily,
  springInErrorFamily,
  springInInputFamily,
} from "../store/springInAtoms";
import { SPRING_IN_MODELS, type SpringInInputDto, type SpringInModelId } from "../lib/types";
import { Quantity } from "./Quantity";
import { SafeNumberInput } from "./SafeNumberInput";
import { BackLink } from "./BackLink";
import { Sym } from "./Sym";
import { SpringInOutlineView } from "./charts/SpringInOutlineView";
import { HowWasThisComputed } from "./HowWasThisComputed";
import { formatSignificant } from "../lib/numberFormat";
import { useLocale, useT } from "../i18n";

// How far a corner cured from this laminate closes when it leaves the tool.
//
// The cheapest module in the program and one of the most useful: it is a
// closed-form expression, not a solve, and what it answers is a question that
// otherwise costs a trial part. A laminate shrinks far more through its
// thickness than along its fibres, and at a bend that difference goes into the
// angle - so the part comes off sharper than the tool it was cured on, and the
// tool has to be cut with a deliberate overbend to compensate.
//
// One number does the work: the laminate's own thermal expansion coefficient
// in the direction running around the bend, which the CLT already knows. The
// through-thickness one has to be typed in, because classical laminate theory
// is a plane stress theory and does not have it.

export function SpringInModuleContent({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const [input, setInput] = useAtom(springInInputFamily(laminateId));
  const error = useAtomValue(springInErrorFamily(laminateId));
  const state = useAtomValue(loadableSpringInFamily(laminateId));
  const result = state.state === "hasData" ? state.data : null;

  const update = <K extends keyof SpringInInputDto>(key: K, value: SpringInInputDto[K]) => {
    setInput((current) => ({ ...current, [key]: value }));
  };

  const setModel = (id: SpringInModelId) => {
    setInput((current) => ({
      ...current,
      // The shrinkage strains are kept while switching back and forth, so a
      // reader comparing the two models does not have to retype them.
      model:
        id === "enhanced_radford"
          ? {
              model: "enhanced_radford",
              eps_circumferential:
                current.model.model === "enhanced_radford" ? current.model.eps_circumferential : 0,
              eps_thickness:
                current.model.model === "enhanced_radford" ? current.model.eps_thickness : 0,
            }
          : { model: "simple_radford" },
      model_name:
        id === "enhanced_radford" ? "enhanced Radford Model" : "Simple Radford Model",
    }));
  };

  const setShrinkage = (key: "eps_circumferential" | "eps_thickness", value: number) => {
    setInput((current) =>
      current.model.model === "enhanced_radford"
        ? { ...current, model: { ...current.model, [key]: value } }
        : current,
    );
  };

  const enhanced = input.model.model === "enhanced_radford" ? input.model : null;

  return (
    <>
      <BackLink to={`/laminates/${laminateId}`} label={t("nav.laminate")} />
      <p className="hint">{t("springIn.intro")}</p>

      <div className="module-split">
        <section className="panel module-input">
          <h2>{t("springIn.input.title")}</h2>

          <h3>{t("springIn.geometry")}</h3>
          <div className="field-grid">
            <label>
              <span className="field-label">
                <Sym base="φ" />
              </span>
              <Quantity
                category="angle"
                value={input.angle}
                onChange={(v) => update("angle", v)}
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
          </div>
          <p className="hint">{t("springIn.geometry.hint")}</p>

          <h3>{t("springIn.process")}</h3>
          <div className="field-grid">
            <label>
              <span className="field-label">
                <Sym base="T" sub="Basis" />
              </span>
              <Quantity
                category="temperature"
                value={input.base_temp}
                onChange={(v) => update("base_temp", v)}
              />
            </label>
            <label>
              <span className="field-label">
                <Sym base="T" sub="H" />
              </span>
              <Quantity
                category="temperature"
                value={input.hardening_temp}
                onChange={(v) => update("hardening_temp", v)}
              />
            </label>
            <label className="wide">
              <span className="field-label">
                <Sym base="α" sub="T,d" />
              </span>
              <Quantity
                category="thermalExpansion"
                value={input.alphat_thick}
                onChange={(v) => update("alphat_thick", v)}
              />
            </label>
          </div>
          <p className="hint">{t("springIn.alphaThick.hint")}</p>

          <h3>{t("springIn.model")}</h3>
          <div className="field-grid">
            <label className="wide">
              <span className="field-label">{t("springIn.model")}</span>
              <select
                value={input.model.model}
                onChange={(e) => setModel(e.target.value as SpringInModelId)}
              >
                {SPRING_IN_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {t(m.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              <span className="field-label">{t("springIn.circumDirection")}</span>
              <select
                value={input.zero_deg_as_circum_dir ? "0" : "90"}
                onChange={(e) => update("zero_deg_as_circum_dir", e.target.value === "0")}
              >
                <option value="0">{t("springIn.circumDirection.zero")}</option>
                <option value="90">{t("springIn.circumDirection.ninety")}</option>
              </select>
            </label>
            {enhanced && (
              <>
                <label>
                  <span className="field-label">
                    <Sym base="ε" sub="C,u" />
                  </span>
                  <SafeNumberInput
                    value={enhanced.eps_circumferential}
                    onChange={(v) => setShrinkage("eps_circumferential", v)}
                  />
                </label>
                <label>
                  <span className="field-label">
                    <Sym base="ε" sub="C,d" />
                  </span>
                  <SafeNumberInput
                    value={enhanced.eps_thickness}
                    onChange={(v) => setShrinkage("eps_thickness", v)}
                  />
                </label>
              </>
            )}
          </div>
          <p className="hint">{t(`springIn.model.hint.${input.model.model}`)}</p>
          {enhanced && <p className="hint">{t("springIn.shrinkage.hint")}</p>}
        </section>

        <div className="module-results">
          {/* The module refuses for two reasons, and they are different kinds
              of problem: an unsymmetric stack is a laminate this model cannot
              describe, a radius under half the thickness is a typo. */}
          {error &&
            (error.includes("symmetric laminate") ? (
              <p className="warning">
                <TriangleAlert size={14} /> {t("springIn.needsSymmetric")}{" "}
                <Link to={`/laminates/${laminateId}`}>{t("buckling.symmetryWarning.link")}</Link>
              </p>
            ) : (
              <p className="error">{t("springIn.error", { message: error })}</p>
            ))}
          {state.state === "loading" && <p className="hint">{t("results.computing")}</p>}

          {result && (
            <>
              <section className="panel">
                <h2>{t("springIn.result.title")}</h2>

                <div className="stat-tiles">
                  <div className="stat-tile">
                    <span className="label">{t("springIn.deltaAngle")}</span>
                    <span className="value">
                      {formatSignificant(result.delta_angle, 4, locale)}
                      <span className="quantity-unit">°</span>
                    </span>
                  </div>
                  <div className="stat-tile">
                    <span className="label">{t("springIn.finalAngle")}</span>
                    <span className="value">
                      {formatSignificant(result.final_angle, 5, locale)}
                      <span className="quantity-unit">°</span>
                    </span>
                  </div>
                  <div className="stat-tile">
                    <span className="label">{t("springIn.alphaCircum")}</span>
                    <span className="value">
                      {formatSignificant(result.alpha_circumferential * 1e6, 4, locale)}
                      <span className="quantity-unit"> ppm/K</span>
                    </span>
                  </div>
                </div>

                {enhanced && (
                  <p className="hint">
                    {t("springIn.split", {
                      thermal: formatSignificant(result.thermal_angle, 4, locale),
                      chemical: formatSignificant(result.chemical_angle, 4, locale),
                    })}
                  </p>
                )}

                <HowWasThisComputed
                  title={t("springIn.how.title")}
                  formula={
                    "\\frac{\\Delta\\varphi}{\\varphi} = \\frac{\\left(\\alpha_{u} - \\alpha_{d}\\right)\\Delta T}{1 + \\alpha_{d}\\,\\Delta T}"
                  }
                  substituted={`\\Delta\\varphi = ${formatSignificant(result.delta_angle, 6, locale)}^\\circ`}
                >
                  <p className="hint">
                    {t("springIn.how.hint", {
                      alpha: formatSignificant(result.alpha_circumferential * 1e6, 4, locale),
                      deltaT: formatSignificant(result.delta_t, 4, locale),
                    })}
                  </p>
                </HowWasThisComputed>
              </section>

              <section className="panel">
                <h2>{t("springIn.outline.title")}</h2>
                <SpringInOutlineView
                  angle={input.angle}
                  radius={input.radius}
                  thickness={result.thickness}
                  deltaAngle={result.delta_angle}
                />
                <p className="hint">{t("springIn.outline.hint")}</p>
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
