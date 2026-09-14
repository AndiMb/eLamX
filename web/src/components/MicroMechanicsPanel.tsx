import { useAtomValue, useSetAtom, useAtom } from "jotai";
import { Link } from "react-router-dom";
import { materialsAtom } from "../store/materialsAtoms";
import {
  fibresAtom,
  matricesAtom,
  recomputeMicromechanicsAtom,
} from "../store/micromechanicsAtoms";
import { defaultMicroMechanics } from "../lib/constants";
import {
  MICRO_MODELS,
  MICRO_PROPERTIES,
  type MaterialDto,
  type MicroMechanicsDto,
  type MicroModelId,
} from "../lib/types";
import { SafeNumberInput } from "./SafeNumberInput";
import { useT } from "../i18n";

// The "derive this ply from a fibre and a matrix" half of the material page.
//
// What it edits is the DEFINITION, never the numbers: the five properties it
// drives are shown in the panel above it, and are rewritten by
// `recomputeMicromechanicsAtom` whenever anything here changes. That split is
// the original's own - eLamX stores the computed values on the material and
// asks the models again on every read - and it is what lets the rest of this
// app treat a micromechanic ply as an ordinary one.
//
// The models are offered per property rather than per material because that is
// the choice eLamX offers, and the reason is physical: all seven predict the
// density, the stiffness along the fibre and the Poisson's ratio with the same
// rule of mixtures, and differ only across the fibre and in shear.

export function MicroMechanicsPanel({ material }: { material: MaterialDto }) {
  const t = useT();
  const [materials, setMaterials] = useAtom(materialsAtom);
  const fibres = useAtomValue(fibresAtom);
  const matrices = useAtomValue(matricesAtom);
  const recompute = useSetAtom(recomputeMicromechanicsAtom);

  const micro = material.micro;

  const write = (next: MicroMechanicsDto | null) => {
    setMaterials(materials.map((m) => (m.id === material.id ? { ...m, micro: next } : m)));
    void recompute();
  };

  const update = (patch: Partial<MicroMechanicsDto>) => {
    if (!micro) return;
    write({ ...micro, ...patch });
  };

  const canEnable = fibres.length > 0 && matrices.length > 0;
  const missingConstituent =
    micro !== null &&
    (!fibres.some((f) => f.id === micro.fibre_id) || !matrices.some((m) => m.id === micro.matrix_id));

  return (
    <section className="panel">
      <h2>{t("micro.title")}</h2>
      <p className="hint">{t("micro.hint")}</p>

      <div className="flags">
        <label>
          <input
            type="checkbox"
            checked={micro !== null}
            disabled={!canEnable && micro === null}
            onChange={(e) =>
              write(e.target.checked ? defaultMicroMechanics(fibres[0].id, matrices[0].id) : null)
            }
          />
          {t("micro.enable")}
        </label>
      </div>

      {!canEnable && micro === null && (
        <p className="hint">
          {t("micro.needsConstituents")}{" "}
          <Link to="/materials">{t("nav.materials")}</Link>
        </p>
      )}

      {micro && (
        <>
          {missingConstituent && <p className="error">{t("micro.missing")}</p>}

          <div className="field-grid">
            <label>
              <span className="field-label">{t("micro.fibre")}</span>
              <select
                value={micro.fibre_id}
                onChange={(e) => update({ fibre_id: e.target.value })}
              >
                {fibres.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">{t("micro.matrix")}</span>
              <select
                value={micro.matrix_id}
                onChange={(e) => update({ matrix_id: e.target.value })}
              >
                {matrices.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="field-label">{t("micro.phi")}</span>
              <SafeNumberInput value={micro.phi} onChange={(v) => update({ phi: v })} />
            </label>
          </div>
          <p className="hint">{t("micro.phi.hint")}</p>

          <h3>{t("micro.models")}</h3>
          <div className="field-grid">
            {MICRO_PROPERTIES.map(({ model, labelKey }) => (
              <label key={model}>
                <span className="field-label">{t(labelKey)}</span>
                <select
                  value={micro[model] as MicroModelId}
                  onChange={(e) => update({ [model]: e.target.value as MicroModelId })}
                >
                  {MICRO_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {t(m.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="hint">{t("micro.predicted")}</p>
          <p className="hint">{t("micro.rhoModel.hint")}</p>
        </>
      )}
    </section>
  );
}
