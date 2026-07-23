import { useAtom } from "jotai";
import { useParams } from "react-router-dom";
import { Diamond } from "lucide-react";
import { materialsAtom } from "../store/materialsAtoms";
import { MAX_STRAIN_KEYS, TSAI_WU_KEYS, PUCK_KEYS, FMC_KEYS, ZTL_KEYS, type MaterialDto } from "../lib/types";
import { Quantity } from "../components/Quantity";
import { SafeNumberInput } from "../components/SafeNumberInput";
import { BackLink } from "../components/BackLink";

export function MaterialPage() {
  const { materialId } = useParams<{ materialId: string }>();
  const [materials, setMaterials] = useAtom(materialsAtom);
  const material = materials.find((m) => m.id === materialId);

  if (!material) {
    return <p className="hint">Material nicht gefunden.</p>;
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
      <BackLink to="/materials" label="Materialien" />
      <label className="material-name">
        Name
        <input type="text" value={material.name} onChange={(e) => updateName(e.target.value)} />
      </label>

      <h2>
        <Diamond size={16} strokeWidth={1.75} />
        Werkstoffkennwerte
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

      <h3>Festigkeiten</h3>
      <div className="field-grid">
        <label>
          <span className="field-label">
            R<sub>&#8741;,z</sub>
          </span>
          <Quantity category="stress" value={material.r_par_ten} onChange={(v) => update("r_par_ten", v)} />
        </label>
        <label>
          <span className="field-label">
            R<sub>&#8741;,d</sub>
          </span>
          <Quantity category="stress" value={material.r_par_com} onChange={(v) => update("r_par_com", v)} />
        </label>
        <label>
          <span className="field-label">
            R<sub>&perp;,z</sub>
          </span>
          <Quantity category="stress" value={material.r_nor_ten} onChange={(v) => update("r_nor_ten", v)} />
        </label>
        <label>
          <span className="field-label">
            R<sub>&perp;,d</sub>
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

      <h3>Zusatzparameter je Versagenskriterium</h3>
      <p className="hint">
        Gelten materialweit für jedes Laminat, das dieses Material verwendet - abhängig davon, welches Kriterium die
        jeweilige Lage auswählt. Standardmäßig eingeklappt: nur nötig, wenn eine Lage tatsächlich dieses Kriterium
        verwendet.
      </p>

      <details className="criterion-params">
        <summary>Max. Dehnung</summary>
        <div className="field-grid">
          <label>
            <span className="field-label">
              &epsilon;<sub>x,krit</sub>
            </span>
            <Quantity
              category="strain"
              value={material.additional_values[MAX_STRAIN_KEYS.epsX] ?? 0}
              onChange={(v) => updateAdditionalValue(MAX_STRAIN_KEYS.epsX, v)}
            />
          </label>
          <label>
            <span className="field-label">
              &epsilon;<sub>y,krit</sub>
            </span>
            <Quantity
              category="strain"
              value={material.additional_values[MAX_STRAIN_KEYS.epsY] ?? 0}
              onChange={(v) => updateAdditionalValue(MAX_STRAIN_KEYS.epsY, v)}
            />
          </label>
          <label>
            <span className="field-label">
              &gamma;<sub>xy,krit</sub>
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
            global (statt lokal)
          </label>
        </div>
      </details>

      <details className="criterion-params">
        <summary>Tsai-Wu</summary>
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
        <summary>Puck</summary>
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
        <summary>FMC (Cuntze)</summary>
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
        <summary>ZTL</summary>
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
    </section>
  );
}
