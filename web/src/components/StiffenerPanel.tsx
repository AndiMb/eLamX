import { Plus, X } from "lucide-react";
import { SafeNumberInput } from "./SafeNumberInput";
import { defaultStiffener, withProfile } from "../lib/stiffeners";
import {
  STIFFENER_DIRECTIONS,
  STIFFENER_PROFILES,
  type StiffenerDto,
  type StiffenerProfileId,
} from "../lib/types";
import { useT } from "../i18n";

// The stiffener list, shared by the buckling and the deformation module.
//
// One component for both because a stiffener means the same thing in both:
// elamx-core adds its contribution to the same stiffness matrix either way,
// and eLamX 3.x likewise shows the identical "Versteifung" tab in the two
// modules. Two copies of this form would be two places for the position
// convention to drift.
//
// The section properties are NOT echoed back for the profiles. Showing what a
// T stringer's I comes to would mean a second copy of those formulas on this
// side of the wasm boundary, where nothing checks them against the original -
// and a number that is wrong but confidently displayed is worse than no
// number. The profile hints say what the geometry means instead.

export function StiffenerPanel({
  stiffeners,
  onChange,
  length,
  width,
}: {
  stiffeners: StiffenerDto[];
  onChange: (next: StiffenerDto[]) => void;
  /** Plate extent, to say when a position has fallen off the plate. */
  length: number;
  width: number;
}) {
  const t = useT();

  const update = (index: number, patch: Partial<StiffenerDto>) =>
    onChange(
      stiffeners.map((s, i) => (i === index ? ({ ...s, ...patch } as StiffenerDto) : s)),
    );

  const setProfile = (index: number, profile: StiffenerProfileId) =>
    onChange(stiffeners.map((s, i) => (i === index ? withProfile(s, profile) : s)));

  const add = () =>
    onChange([...stiffeners, defaultStiffener("i_profile", `S${stiffeners.length + 1}`)]);

  const remove = (index: number) => onChange(stiffeners.filter((_, i) => i !== index));

  // Across its own direction: an x stiffener is positioned along y.
  const halfSpan = (stiffener: StiffenerDto) =>
    (stiffener.direction === "x" ? width : length) / 2;

  return (
    <>
      <h3>{t("stiffener.title")}</h3>
      <p className="hint">{t("stiffener.hint")}</p>

      {stiffeners.map((stiffener, index) => {
        const profile = STIFFENER_PROFILES.find((p) => p.id === stiffener.profile);
        const outside = Math.abs(stiffener.position) > halfSpan(stiffener);
        return (
          <div className="deformation-load" key={index}>
            <div className="field-grid">
              <label>
                <span className="field-label">{t("stiffener.name")}</span>
                <input
                  type="text"
                  value={stiffener.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                />
              </label>
              <label>
                <span className="field-label">{t("stiffener.profile")}</span>
                <select
                  value={stiffener.profile}
                  onChange={(e) => setProfile(index, e.target.value as StiffenerProfileId)}
                >
                  {STIFFENER_PROFILES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {t(p.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">{t("stiffener.direction")}</span>
                <select
                  value={stiffener.direction}
                  onChange={(e) =>
                    update(index, { direction: e.target.value as StiffenerDto["direction"] })
                  }
                >
                  {STIFFENER_DIRECTIONS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {t(d.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">{t("stiffener.position")}</span>
                <SafeNumberInput
                  value={stiffener.position}
                  onChange={(v) => update(index, { position: v })}
                />
              </label>

              {profile?.fields.map((field) => (
                <label key={field}>
                  <span className="field-label">{t(`stiffener.field.${field}`)}</span>
                  <SafeNumberInput
                    value={(stiffener as unknown as Record<string, number>)[field] ?? 0}
                    onChange={(v) => update(index, { [field]: v } as Partial<StiffenerDto>)}
                  />
                </label>
              ))}
              <p className="hint field-grid-note">
                {t(`stiffener.profile.hint.${stiffener.profile}`)}
                {outside && ` ${t("stiffener.position.outside", { name: stiffener.name })}`}
              </p>
            </div>

            <button
              type="button"
              className="icon-button"
              onClick={() => remove(index)}
              title={t("stiffener.remove")}
              aria-label={t("stiffener.remove")}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}

      {stiffeners.length > 0 && (
        <>
          <p className="hint">{t("stiffener.position.hint")}</p>
          {stiffeners.some((s) => s.profile === "direct") && (
            <p className="hint">{t("stiffener.mass.hint")}</p>
          )}
        </>
      )}

      <div className="flags">
        <button type="button" onClick={add}>
          <Plus size={14} /> {t("stiffener.add")}
        </button>
      </div>
    </>
  );
}
