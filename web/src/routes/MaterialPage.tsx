import { useAtom } from "jotai";
import { useParams } from "react-router-dom";
import { Diamond } from "lucide-react";
import { materialsAtom } from "../store/materialsAtoms";
import { MAX_STRAIN_KEYS, TSAI_WU_KEYS, PUCK_KEYS, FMC_KEYS, ZTL_KEYS, type MaterialDto } from "../lib/types";
import { Quantity } from "../components/Quantity";
import { SafeNumberInput } from "../components/SafeNumberInput";
import { BackLink } from "../components/BackLink";
import { useT } from "../i18n";
import { ModuleList } from "../components/ModuleList";

export function MaterialPage() {
  const t = useT();
  const { materialId } = useParams<{ materialId: string }>();
  const [materials, setMaterials] = useAtom(materialsAtom);
  const material = materials.find((m) => m.id === materialId);

  if (!material) {
    return <p className="hint">{t("material.notFound")}</p>;
  }

  const update = (key: keyof MaterialDto, value: number) => {
    setMaterials((ms) => ms.map((m) => (m.id === material.id ? { ...m, [key]: value } : m)));
  };

  const updateName = (name: string) => {
    setMaterials((ms) => ms.map((m) => (m.id === material.id ? { ...m, name } : m)));
  };

  const updateAdditionalValue = (key: string, value: number) => {
    setMaterials((ms) =>
      ms.map((m) => (m.id === material.id ? { ...m, additional_values: { ...m.additional_values, [key]: value } } : m)),
    );
  };

  return (
    <section className="panel">
      <BackLink to="/materials" label={t("nav.materials")} />
      <label className="material-name">
        {t("common.name")}
        <input type="text" value={material.name} onChange={(e) => updateName(e.target.value)} />
      </label>

      <h2>
        <Diamond size={16} strokeWidth={1.75} />
        {t("material.properties")}
      </h2>
      <div className="field-grid">
        <label>
          <span className="field-label">
            E<sub>&#8741;</sub>
          </span>
          <Quantity category="stiffness" value={material.e_par} onChange={(v) => update("e_par", v)} />
        </label>
        <label>
          <span className="field-label">
            E<sub>&perp;</sub>
          </span>
          <Quantity category="stiffness" value={material.e_nor} onChange={(v) => update("e_nor", v)} />
        </label>
        <label>
          <span className="field-label">
            &nu;<sub>12</sub>
          </span>
          <Quantity category="poissonRatio" value={material.nue12} onChange={(v) => update("nue12", v)} />
        </label>
        <label>
          <span className="field-label">G</span>
          <Quantity category="stiffness" value={material.g} onChange={(v) => update("g", v)} />
        </label>
      </div>

      {/* Without these the hygrothermal load vector in the equation panel is
          identically zero no matter what dT/dH the user enters - alpha and
          beta are the only things that turn a state change into a load. */}
      <h3>{t("material.hygrothermal")}</h3>
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

      <h3>{t("material.strengths")}</h3>
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

      <h3>{t("material.criterionParams")}</h3>
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

      {/* Modules that are about the MATERIAL rather than a laminate - the
          scope the registry gained for exactly this. */}
      <ModuleList scope="material" ownerId={material.id} />
    </section>
  );
}
