import { useAtom } from "jotai";
import { useParams } from "react-router-dom";
import { Diamond } from "lucide-react";
import { materialsAtom } from "../store/materialsAtoms";
import {
  MAX_STRAIN_KEYS,
  MICRO_PROPERTIES,
  TSAI_WU_KEYS,
  PUCK_KEYS,
  FMC_KEYS,
  ZTL_KEYS,
  ABAQUS_TSAI_WU_KEYS,
  AUTODESK_TSAI_WU_KEYS,
  AUTODESK_HASHIN_KEYS,
  LS_DYNA_KEYS,
  type MaterialDto,
} from "../lib/types";
import { Quantity } from "../components/Quantity";
import { QuantityDisplay } from "../components/QuantityDisplay";
import { SafeNumberInput } from "../components/SafeNumberInput";
import { BackLink } from "../components/BackLink";
import { useT } from "../i18n";
import { ModuleList } from "../components/ModuleList";
import { MicroMechanicsPanel } from "../components/MicroMechanicsPanel";

export function MaterialPage() {
  const t = useT();
  const { materialId } = useParams<{ materialId: string }>();
  const [materials, setMaterials] = useAtom(materialsAtom);
  const material = materials.find((m) => m.id === materialId);

  if (!material) {
    return <p className="empty-note">{t("material.notFound")}</p>;
  }

  const update = (key: keyof MaterialDto, value: number) => {
    setMaterials((ms) => ms.map((m) => (m.id === material.id ? { ...m, [key]: value } : m)));
  };

  const updateName = (name: string) => {
    setMaterials((ms) => ms.map((m) => (m.id === material.id ? { ...m, name } : m)));
  };

  // A property a micromechanical model drives is shown, not offered: typing
  // into it would be overwritten by the next recompute, which is the kind of
  // field that makes a reader distrust the whole page. `manual` is a model
  // choice too, and means exactly "leave this one editable".
  const predicted = (property: keyof MaterialDto) => {
    const micro = material.micro;
    if (!micro) return false;
    const entry = MICRO_PROPERTIES.find((p) => p.property === property);
    return entry !== undefined && micro[entry.model] !== "manual";
  };

  const basic = (
    property: "e_par" | "e_nor" | "nue12" | "g" | "rho",
    category: "stiffness" | "poissonRatio" | "density",
  ) =>
    predicted(property) ? (
      <QuantityDisplay category={category} value={material[property]} />
    ) : (
      <Quantity
        category={category}
        value={material[property]}
        onChange={(v) => update(property, v)}
      />
    );

  const updateAdditionalValue = (key: string, value: number) => {
    setMaterials((ms) =>
      ms.map((m) => (m.id === material.id ? { ...m, additional_values: { ...m.additional_values, [key]: value } } : m)),
    );
  };

  return (
    <>
      <BackLink to="/materials" label={t("nav.materials")} />
      {/* As on the laminate page: the visible hierarchy starts at h2, so the
          page's own name is the h1 for heading navigation. */}
      <h1 className="visually-hidden">{material.name}</h1>

      <section className="panel">
        <h2>
          <Diamond size={16} strokeWidth={1.75} />
          {t("material.properties")}
        </h2>
        <label className="material-name compact">
          {t("common.name")}
          <input type="text" value={material.name} onChange={(e) => updateName(e.target.value)} />
        </label>
        <div className="field-grid">
          <label>
            <span className="field-label">
              E<sub>&#8741;</sub>
            </span>
            {basic("e_par", "stiffness")}
          </label>
          <label>
            <span className="field-label">
              E<sub>&perp;</sub>
            </span>
            {basic("e_nor", "stiffness")}
          </label>
          <label>
            <span className="field-label">
              &nu;<sub>12</sub>
            </span>
            {basic("nue12", "poissonRatio")}
          </label>
          <label>
            <span className="field-label">G</span>
            {basic("g", "stiffness")}
          </label>
          {/* The density had no field until micromechanics arrived, which
              predicts it: the laminate's mass moments were computed from a
              number nobody could see, let alone correct. */}
          <label>
            <span className="field-label">&rho;</span>
            {basic("rho", "density")}
          </label>
        </div>

        {/* Without these the hygrothermal load vector in the equation panel is
            identically zero no matter what dT/dH the user enters - alpha and
            beta are the only things that turn a state change into a load. */}
      </section>

      <MicroMechanicsPanel material={material} />

      <section className="panel">
        <h2>{t("material.hygrothermal")}</h2>
        <p className="hint">{t("material.hygrothermal.hint")}</p>
        <div className="field-grid">
          <label>
            <span className="field-label">
              &alpha;<sub>T,&#8741;</sub>
            </span>
            <Quantity
              category="thermalExpansion"
              value={material.alpha_t_par}
              onChange={(v) => update("alpha_t_par", v)}
            />
          </label>
          <label>
            <span className="field-label">
              &alpha;<sub>T,&perp;</sub>
            </span>
            <Quantity
              category="thermalExpansion"
              value={material.alpha_t_nor}
              onChange={(v) => update("alpha_t_nor", v)}
            />
          </label>
          <label>
            <span className="field-label">
              &beta;<sub>&#8741;</sub>
            </span>
            <Quantity category="hygralExpansion" value={material.beta_par} onChange={(v) => update("beta_par", v)} />
          </label>
          <label>
            <span className="field-label">
              &beta;<sub>&perp;</sub>
            </span>
            <Quantity category="hygralExpansion" value={material.beta_nor} onChange={(v) => update("beta_nor", v)} />
          </label>
        </div>

      </section>

      <section className="panel">
        <h2>{t("material.strengths")}</h2>
        <div className="field-grid">
          <label>
            <span className="field-label">
              R<sub>&#8741;,{t("material.sym.tension")}</sub>
            </span>
            <Quantity category="stress" value={material.r_par_ten} onChange={(v) => update("r_par_ten", v)} />
          </label>
          <label>
            <span className="field-label">
              R<sub>&#8741;,{t("material.sym.compression")}</sub>
            </span>
            <Quantity category="stress" value={material.r_par_com} onChange={(v) => update("r_par_com", v)} />
          </label>
          <label>
            <span className="field-label">
              R<sub>&perp;,{t("material.sym.tension")}</sub>
            </span>
            <Quantity category="stress" value={material.r_nor_ten} onChange={(v) => update("r_nor_ten", v)} />
          </label>
          <label>
            <span className="field-label">
              R<sub>&perp;,{t("material.sym.compression")}</sub>
            </span>
            <Quantity category="stress" value={material.r_nor_com} onChange={(v) => update("r_nor_com", v)} />
          </label>
          <label>
            <span className="field-label">
              R<sub>&#8741;&perp;</sub>
            </span>
            <Quantity category="stress" value={material.r_shear} onChange={(v) => update("r_shear", v)} />
          </label>
        </div>

      </section>

      <section className="panel">
        <h2>{t("material.criterionParams")}</h2>
        <p className="hint">{t("material.criterionParams.hint")}</p>

        <details className="criterion-params">
          <summary>{t("criterion.max_strain")}</summary>
          <div className="field-grid">
            <label>
              <span className="field-label">
                &epsilon;<sub>x,{t("material.sym.critical")}</sub>
              </span>
              <Quantity
                category="strain"
                value={material.additional_values[MAX_STRAIN_KEYS.epsX] ?? 0}
                onChange={(v) => updateAdditionalValue(MAX_STRAIN_KEYS.epsX, v)}
              />
            </label>
            <label>
              <span className="field-label">
                &epsilon;<sub>y,{t("material.sym.critical")}</sub>
              </span>
              <Quantity
                category="strain"
                value={material.additional_values[MAX_STRAIN_KEYS.epsY] ?? 0}
                onChange={(v) => updateAdditionalValue(MAX_STRAIN_KEYS.epsY, v)}
              />
            </label>
            <label>
              <span className="field-label">
                &gamma;<sub>xy,{t("material.sym.critical")}</sub>
              </span>
              <Quantity
                category="strain"
                value={material.additional_values[MAX_STRAIN_KEYS.gammaXy] ?? 0}
                onChange={(v) => updateAdditionalValue(MAX_STRAIN_KEYS.gammaXy, v)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={(material.additional_values[MAX_STRAIN_KEYS.globalLocal] ?? 0) > 0.5}
                onChange={(e) => updateAdditionalValue(MAX_STRAIN_KEYS.globalLocal, e.target.checked ? 1 : 0)}
              />
              {t("material.maxStrain.useGlobal")}
            </label>
          </div>
        </details>

        <details className="criterion-params">
          <summary>{t("criterion.tsai_wu")}</summary>
          <div className="field-grid">
            <label>
              <span className="field-label">
                F<sub>12</sub>
                <sup>*</sup>
              </span>
              <SafeNumberInput
                value={material.additional_values[TSAI_WU_KEYS.f12Star] ?? 0}
                onChange={(v) => updateAdditionalValue(TSAI_WU_KEYS.f12Star, v)}
              />
            </label>
          </div>
        </details>

        <details className="criterion-params">
          <summary>{t("criterion.puck")}</summary>
          <div className="field-grid">
            <label>
              <span className="field-label">
                p<sub>&perp;&#8741;</sub>
              </span>
              <SafeNumberInput
                value={material.additional_values[PUCK_KEYS.pSpd] ?? 0}
                onChange={(v) => updateAdditionalValue(PUCK_KEYS.pSpd, v)}
              />
            </label>
            <label>
              <span className="field-label">
                p<sub>&perp;&perp;</sub>
              </span>
              <SafeNumberInput
                value={material.additional_values[PUCK_KEYS.pSpz] ?? 0}
                onChange={(v) => updateAdditionalValue(PUCK_KEYS.pSpz, v)}
              />
            </label>
            <label>
              <span className="field-label">
                a<sub>0</sub>
              </span>
              <SafeNumberInput
                value={material.additional_values[PUCK_KEYS.a0] ?? 0}
                onChange={(v) => updateAdditionalValue(PUCK_KEYS.a0, v)}
              />
            </label>
            <label>
              <span className="field-label">
                &lambda;<sub>min</sub>
              </span>
              <SafeNumberInput
                value={material.additional_values[PUCK_KEYS.lambdaMin] ?? 0}
                onChange={(v) => updateAdditionalValue(PUCK_KEYS.lambdaMin, v)}
              />
            </label>
          </div>
        </details>

        <details className="criterion-params">
          <summary>{t("criterion.fmc")}</summary>
          <div className="field-grid">
            <label>
              <span className="field-label">
                &mu;<sub>&perp;&#8741;</sub>
              </span>
              <SafeNumberInput
                value={material.additional_values[FMC_KEYS.mueSp] ?? 0}
                onChange={(v) => updateAdditionalValue(FMC_KEYS.mueSp, v)}
              />
            </label>
            <label>
              <span className="field-label">m</span>
              <SafeNumberInput
                value={material.additional_values[FMC_KEYS.m] ?? 0}
                onChange={(v) => updateAdditionalValue(FMC_KEYS.m, v)}
              />
            </label>
          </div>
        </details>

        <details className="criterion-params">
          <summary>{t("criterion.ztl")}</summary>
          <div className="field-grid">
            <label>
              <span className="field-label">
                F<sub>12</sub>
                <sup>*</sup>
              </span>
              <SafeNumberInput
                value={material.additional_values[ZTL_KEYS.f12Star] ?? 0}
                onChange={(v) => updateAdditionalValue(ZTL_KEYS.f12Star, v)}
              />
            </label>
          </div>
        </details>

        <details className="criterion-params">
          <summary>{t("criterion.abaqus_tsai_wu")}</summary>
          <div className="field-grid">
            <label>
              <span className="field-label">
                F<sub>12</sub>
                <sup>*</sup>
              </span>
              <SafeNumberInput
                value={material.additional_values[ABAQUS_TSAI_WU_KEYS.f12Star] ?? 0}
                onChange={(v) => updateAdditionalValue(ABAQUS_TSAI_WU_KEYS.f12Star, v)}
              />
            </label>
            {/* Zero means no equibiaxial strength was measured, and then the
                F12* above decides the interaction term instead. */}
            <label>
              <span className="field-label">
                &sigma;<sub>biax</sub>
              </span>
              <SafeNumberInput
                value={material.additional_values[ABAQUS_TSAI_WU_KEYS.sigBiax] ?? 0}
                onChange={(v) => updateAdditionalValue(ABAQUS_TSAI_WU_KEYS.sigBiax, v)}
              />
            </label>
          </div>
        </details>

        <details className="criterion-params">
          <summary>{t("criterion.autodesk_tsai_wu")}</summary>
          <div className="field-grid">
            <label>
              <span className="field-label">
                F<sub>12</sub>
                <sup>*</sup>
              </span>
              <SafeNumberInput
                value={material.additional_values[AUTODESK_TSAI_WU_KEYS.f12Star] ?? 0}
                onChange={(v) => updateAdditionalValue(AUTODESK_TSAI_WU_KEYS.f12Star, v)}
              />
            </label>
            <label>
              <span className="field-label">
                &sigma;<sub>biax</sub>
              </span>
              <SafeNumberInput
                value={material.additional_values[AUTODESK_TSAI_WU_KEYS.sigBiax] ?? 0}
                onChange={(v) => updateAdditionalValue(AUTODESK_TSAI_WU_KEYS.sigBiax, v)}
              />
            </label>
          </div>
        </details>

        <details className="criterion-params">
          <summary>{t("criterion.autodesk_hashin")}</summary>
          <div className="field-grid">
            <label>
              <span className="field-label">&alpha;</span>
              <SafeNumberInput
                value={material.additional_values[AUTODESK_HASHIN_KEYS.alpha] ?? 0}
                onChange={(v) => updateAdditionalValue(AUTODESK_HASHIN_KEYS.alpha, v)}
              />
            </label>
            <label>
              <span className="field-label">
                R<sub>23</sub>
              </span>
              <SafeNumberInput
                value={material.additional_values[AUTODESK_HASHIN_KEYS.r23] ?? 0}
                onChange={(v) => updateAdditionalValue(AUTODESK_HASHIN_KEYS.r23, v)}
              />
            </label>
          </div>
        </details>

        <details className="criterion-params">
          <summary>{t("criterion.ls_dyna_chang_chang")}</summary>
          <div className="field-grid">
            <label>
              <span className="field-label">&beta;</span>
              <SafeNumberInput
                value={material.additional_values[LS_DYNA_KEYS.changChangBeta] ?? 0}
                onChange={(v) => updateAdditionalValue(LS_DYNA_KEYS.changChangBeta, v)}
              />
            </label>
          </div>
        </details>

        <details className="criterion-params">
          <summary>{t("criterion.ls_dyna_tsai_wu")}</summary>
          <div className="field-grid">
            <label>
              <span className="field-label">&beta;</span>
              <SafeNumberInput
                value={material.additional_values[LS_DYNA_KEYS.tsaiWuBeta] ?? 0}
                onChange={(v) => updateAdditionalValue(LS_DYNA_KEYS.tsaiWuBeta, v)}
              />
            </label>
          </div>
        </details>

        <details className="criterion-params">
          <summary>{t("criterion.ls_dyna_daimler_camanho")}</summary>
          <div className="field-grid">
            <label>
              <span className="field-label">
                G<sub>1c</sub>
              </span>
              <SafeNumberInput
                value={material.additional_values[LS_DYNA_KEYS.camanhoG1c] ?? 0}
                onChange={(v) => updateAdditionalValue(LS_DYNA_KEYS.camanhoG1c, v)}
              />
            </label>
            <label>
              <span className="field-label">
                G<sub>2c</sub>
              </span>
              <SafeNumberInput
                value={material.additional_values[LS_DYNA_KEYS.camanhoG2c] ?? 0}
                onChange={(v) => updateAdditionalValue(LS_DYNA_KEYS.camanhoG2c, v)}
              />
            </label>
          </div>
        </details>

        <details className="criterion-params">
          <summary>{t("criterion.ls_dyna_daimler_pinho")}</summary>
          <div className="field-grid">
            <label>
              <span className="field-label">
                &alpha;<sub>0</sub> [&deg;]
              </span>
              <SafeNumberInput
                value={material.additional_values[LS_DYNA_KEYS.pinhoAlpha0] ?? 0}
                onChange={(v) => updateAdditionalValue(LS_DYNA_KEYS.pinhoAlpha0, v)}
              />
            </label>
          </div>
        </details>
      </section>

      {/* Modules that are about the MATERIAL rather than a laminate - the
          scope the registry gained for exactly this. */}
      <ModuleList scope="material" ownerId={material.id} />
    </>
  );
}
