import { useAtomValue, useSetAtom } from "jotai";
import { laminateConfigFamily, laminateIdsAtom, loadCasesOf } from "../store/laminateAtoms";
import { updateStudyAtom } from "../store/studyAtoms";
import { STUDY_OUTPUTS } from "../lib/study/evaluate";
import {
  defaultVariation,
  LOAD_COMPONENTS,
  VARIATION_KINDS,
  type StudyDef,
  type SweepDef,
  type VariationDef,
  type VariationKind,
} from "../lib/study/model";
import { OUTPUT_INFO } from "../lib/study/outputs";
import { SafeNumberInput } from "./SafeNumberInput";
import { useT, type MessageKey } from "../i18n";

// The definition of a sweep: which laminate under which load case, what is
// varied over which range, and what is read at every point.

const KIND_KEYS: Record<VariationKind, MessageKey> = {
  angle: "study.variation.angle",
  fraction: "study.variation.fraction",
  load: "study.variation.load",
  plate: "study.variation.plate",
  thickness: "study.variation.thickness",
};

type SweepStudy = Extract<StudyDef, { kind: "sweep" }>;

function VariationEditor({
  legend,
  laminateId,
  value,
  onChange,
}: {
  legend: string;
  laminateId: string;
  value: VariationDef;
  onChange: (v: VariationDef) => void;
}) {
  const t = useT();
  const config = useAtomValue(laminateConfigFamily(laminateId));
  const set = (patch: Partial<VariationDef>) => onChange({ ...value, ...patch });
  const role = (id: string) => (value.layers.includes(id) ? "plus" : value.negated.includes(id) ? "minus" : "none");
  const setRole = (id: string, next: "plus" | "minus" | "none") =>
    set({
      layers: next === "plus" ? [...value.layers.filter((x) => x !== id), id] : value.layers.filter((x) => x !== id),
      negated: next === "minus" ? [...value.negated.filter((x) => x !== id), id] : value.negated.filter((x) => x !== id),
    });

  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="field-grid">
        <label>
          <span className="field-label">{t("study.variation.kind")}</span>
          <select
            value={value.kind}
            onChange={(e) => {
              const kind = e.target.value as VariationKind;
              // A new kind brings its own sensible range; the layer choice stays.
              onChange({ ...defaultVariation(kind), layers: value.layers, negated: value.negated });
            }}
          >
            {VARIATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(KIND_KEYS[k])}
              </option>
            ))}
          </select>
        </label>
        {value.kind === "load" && (
          <label>
            <span className="field-label">{t("study.variation.component")}</span>
            <select value={value.component} onChange={(e) => set({ component: e.target.value as VariationDef["component"] })}>
              {LOAD_COMPONENTS.map((c) => (
                <option key={c} value={c}>
                  {c === "factor" ? t("study.variation.factor") : c.replace("_", "")}
                </option>
              ))}
            </select>
          </label>
        )}
        {value.kind === "plate" && (
          <label>
            <span className="field-label">{t("study.variation.dim")}</span>
            <select value={value.dim} onChange={(e) => set({ dim: e.target.value as "a" | "b" })}>
              <option value="a">a</option>
              <option value="b">b</option>
            </select>
          </label>
        )}
        {value.kind === "fraction" && (
          <label>
            <span className="field-label">{t("study.variation.family")}</span>
            <select value={value.family} onChange={(e) => set({ family: e.target.value as VariationDef["family"] })}>
              <option value="0">0°</option>
              <option value="45">±45°</option>
              <option value="90">90°</option>
            </select>
          </label>
        )}
        <label>
          <span className="field-label">{t("study.variation.from")}</span>
          <SafeNumberInput value={value.from} onChange={(from) => set({ from })} />
        </label>
        <label>
          <span className="field-label">{t("study.variation.to")}</span>
          <SafeNumberInput value={value.to} onChange={(to) => set({ to })} />
        </label>
        <label>
          <span className="field-label">{t("study.variation.steps")}</span>
          <SafeNumberInput value={value.steps} onChange={(steps) => set({ steps: Math.min(1000, Math.max(1, Math.round(steps))) })} />
        </label>
      </div>
      {value.kind === "fraction" && <p className="hint">{t("study.variation.fractionHint")}</p>}
      {(value.kind === "angle" || value.kind === "thickness") && (
        <>
          <p className="hint">{t(value.kind === "angle" ? "study.variation.angleHint" : "study.variation.thicknessHint")}</p>
          <div className="report-checks">
            {config.layers.map((layer, i) =>
              value.kind === "angle" ? (
                <label key={layer.id} className="study-layer-role">
                  <span>
                    {i + 1}. {layer.name} ({layer.angle}°)
                  </span>
                  <select value={role(layer.id)} onChange={(e) => setRole(layer.id, e.target.value as "plus" | "minus" | "none")}>
                    <option value="none">{t("study.variation.keep")}</option>
                    <option value="plus">+θ</option>
                    <option value="minus">−θ</option>
                  </select>
                </label>
              ) : (
                <label key={layer.id} className="inline-check">
                  <input
                    type="checkbox"
                    checked={value.layers.includes(layer.id)}
                    onChange={() =>
                      set({
                        layers: value.layers.includes(layer.id) ? value.layers.filter((x) => x !== layer.id) : [...value.layers, layer.id],
                      })
                    }
                  />
                  {i + 1}. {layer.name}
                </label>
              ),
            )}
          </div>
        </>
      )}
    </fieldset>
  );
}

function LaminateOption({ id }: { id: string }) {
  return <option value={id}>{useAtomValue(laminateConfigFamily(id)).name}</option>;
}

export function SweepEditor({ study }: { study: SweepStudy }) {
  const t = useT();
  const update = useSetAtom(updateStudyAtom);
  const ids = useAtomValue(laminateIdsAtom);
  const def = study.sweep;
  const laminateId = ids.includes(def.laminateId) ? def.laminateId : (ids[0] ?? "");
  const config = useAtomValue(laminateConfigFamily(laminateId));
  const set = (patch: Partial<SweepDef>) => update({ ...study, sweep: { ...def, ...patch } });
  const usesFractions = def.x.kind === "fraction" || def.y?.kind === "fraction";

  return (
    <section className="panel study-editor">
      <h2>{t("study.definition")}</h2>
      <div className="field-grid">
        <label className="wide">
          <span className="field-label">{t("study.matrix.laminate")}</span>
          <select
            value={laminateId}
            onChange={(e) =>
              set({
                laminateId: e.target.value,
                loadCaseId: null,
                // Layer choices belong to the old laminate.
                x: { ...def.x, layers: [], negated: [] },
                y: def.y ? { ...def.y, layers: [], negated: [] } : null,
              })
            }
          >
            {ids.map((id) => (
              <LaminateOption key={id} id={id} />
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">{t("study.matrix.loadCase")}</span>
          <select value={def.loadCaseId ?? ""} onChange={(e) => set({ loadCaseId: e.target.value || null })}>
            <option value="">{t("study.sweep.firstLoadCase")}</option>
            {loadCasesOf(config).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <VariationEditor legend={t("study.sweep.x")} laminateId={laminateId} value={def.x} onChange={(x) => set({ x })} />

      <label className="inline-check study-second">
        <input type="checkbox" checked={def.y !== null} onChange={(e) => set({ y: e.target.checked ? defaultVariation("plate") : null })} />
        {t("study.sweep.second")}
      </label>
      {def.y && <VariationEditor legend={t("study.sweep.y")} laminateId={laminateId} value={def.y} onChange={(y) => set({ y })} />}

      {usesFractions && (
        <fieldset>
          <legend>{t("study.sweep.pLaminate")}</legend>
          <div className="field-grid">
            <label>
              <span className="field-label">{t("study.sweep.plies")}</span>
              <SafeNumberInput value={def.plies} onChange={(v) => set({ plies: Math.max(2, 2 * Math.round(v / 2)) })} />
            </label>
            {(["0°", "±45°", "90°"] as const).map((label, i) => (
              <label key={label}>
                <span className="field-label">
                  p{label} {t("study.sweep.base")}
                </span>
                <SafeNumberInput
                  value={def.fractions[i]}
                  onChange={(v) => {
                    const next = [...def.fractions] as SweepDef["fractions"];
                    next[i] = Math.max(0, v);
                    set({ fractions: next });
                  }}
                />
              </label>
            ))}
          </div>
          <p className="hint">{t("study.sweep.pHint")}</p>
        </fieldset>
      )}

      <fieldset>
        <legend>{t("study.sweep.outputs")}</legend>
        <div className="report-checks">
          {STUDY_OUTPUTS.map((o) => (
            <label key={o} className="inline-check">
              <input
                type="checkbox"
                checked={def.outputs.includes(o)}
                onChange={() =>
                  set({ outputs: def.outputs.includes(o) ? def.outputs.filter((x) => x !== o) : STUDY_OUTPUTS.filter((x) => x === o || def.outputs.includes(x)) })
                }
              />
              {t(OUTPUT_INFO[o].labelKey)}
            </label>
          ))}
        </div>
        <p className="hint">{t("study.sweep.outputsHint")}</p>
      </fieldset>
    </section>
  );
}
