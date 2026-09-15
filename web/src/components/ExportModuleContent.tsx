import { useAtom, useAtomValue } from "jotai";
import { Download } from "lucide-react";
import {
  EXPORT_EXTENSION,
  deckErrorFamily,
  exportOptionsAtom,
  loadableDeckFamily,
  solverSettingsAtom,
  type SolverSettings,
} from "../store/exportAtoms";
import { laminateConfigFamily } from "../store/laminateAtoms";
import type { ExportOptionsDto, OffsetId, SolverId } from "../lib/types";
import { SafeNumberInput } from "./SafeNumberInput";
import { BackLink } from "./BackLink";
import { useT } from "../i18n";

// Handing the laminate to the solver it will actually be analysed in.
//
// What leaves here is the material cards and the layup, and that is worth
// saying on the page rather than only in the code: someone who downloads a
// file called `laminate.bdf` may reasonably expect to be able to run it. They
// cannot. The deck has no mesh, no supports and no load - it is the part eLamX
// knows, to be pasted into a model that has the rest.
//
// The preview is not a nicety. A deck is a text file with column-sensitive
// fields, and seeing it is the only way to notice that a number has been
// truncated to fit before the solver says so in its own way.

const SOLVERS: { id: SolverId; label: string }[] = [
  { id: "nastran", label: "Nastran" },
  { id: "abaqus", label: "Abaqus" },
  { id: "ansys", label: "ANSYS" },
  { id: "ls_dyna", label: "LS-DYNA" },
];

export function ExportModuleContent({ laminateId }: { laminateId: string }) {
  const t = useT();
  const [settings, setSettings] = useAtom(solverSettingsAtom);
  const [options, setOptions] = useAtom(exportOptionsAtom);
  const config = useAtomValue(laminateConfigFamily(laminateId));
  const state = useAtomValue(loadableDeckFamily(laminateId));
  const error = useAtomValue(deckErrorFamily(laminateId));
  const deck = state.state === "hasData" ? state.data : null;

  const update = <K extends keyof SolverSettings>(key: K, value: SolverSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const updateOption = <K extends keyof ExportOptionsDto>(key: K, value: ExportOptionsDto[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const download = () => {
    if (!deck) return;
    const blob = new Blob([deck], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const name = (config.name || "laminat").replace(/[^\w.-]+/g, "_");
    link.download = `${name}.${EXPORT_EXTENSION[settings.solver]}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <>
      <BackLink to={`/laminates/${laminateId}`} label={t("nav.laminate")} />
      <p className="hint">{t("export.intro")}</p>

      <div className="module-split">
        <section className="panel module-input">
          <h2>{t("export.input.title")}</h2>

          <div className="field-grid">
            <label>
              <span className="field-label">{t("export.solver")}</span>
              <select
                value={settings.solver}
                onChange={(e) => update("solver", e.target.value as SolverId)}
              >
                {SOLVERS.map((solver) => (
                  <option key={solver.id} value={solver.id}>
                    {solver.label}
                  </option>
                ))}
              </select>
            </label>

            {settings.solver === "nastran" && (
              <label>
                <span className="field-label">{t("export.nastran.format")}</span>
                <select
                  value={settings.nastranFormat}
                  onChange={(e) =>
                    update("nastranFormat", e.target.value as SolverSettings["nastranFormat"])
                  }
                >
                  <option value="small">{t("export.nastran.small")}</option>
                  <option value="large">{t("export.nastran.large")}</option>
                  <option value="free">{t("export.nastran.free")}</option>
                </select>
              </label>
            )}

            {settings.solver === "ansys" && (
              <label>
                <span className="field-label">{t("export.ansys.layout")}</span>
                <select
                  value={settings.ansysLayout}
                  onChange={(e) =>
                    update("ansysLayout", e.target.value as SolverSettings["ansysLayout"])
                  }
                >
                  <option value="section">{t("export.ansys.section")}</option>
                  <option value="real">{t("export.ansys.real")}</option>
                </select>
              </label>
            )}

            {settings.solver === "ls_dyna" && (
              <label>
                <span className="field-label">{t("export.lsDyna.card")}</span>
                <select
                  value={settings.lsDynaCard}
                  onChange={(e) =>
                    update("lsDynaCard", e.target.value as SolverSettings["lsDynaCard"])
                  }
                >
                  <option value="mat22">MAT22</option>
                  <option value="mat54">MAT54</option>
                  <option value="mat55">MAT55</option>
                  <option value="mat58">MAT58</option>
                </select>
              </label>
            )}

            <label>
              <span className="field-label">{t("export.offset")}</span>
              <select
                value={options.offset}
                onChange={(e) => updateOption("offset", e.target.value as OffsetId)}
              >
                <option value="top">{t("export.offset.top")}</option>
                <option value="mid">{t("export.offset.mid")}</option>
                <option value="bot">{t("export.offset.bot")}</option>
              </select>
            </label>
          </div>

          <div className="field-grid">
            {/* Label first, control second, like every other field on the
                page - a checkbox under its own caption reads as a caption for
                the field below it. */}
            <label>
              <span className="field-label">{t("export.hygrothermal")}</span>
              <input
                type="checkbox"
                checked={options.hygrothermal}
                onChange={(e) => updateOption("hygrothermal", e.target.checked)}
              />
            </label>
            <label>
              <span className="field-label">{t("export.strength")}</span>
              <input
                type="checkbox"
                checked={options.strength}
                onChange={(e) => updateOption("strength", e.target.checked)}
              />
            </label>
          </div>

          {/* The multipliers only mean something for LS-DYNA, whose cards carry
              no units at all. */}
          {settings.solver === "ls_dyna" && (
            <>
              <h3>{t("export.lsDyna.units")}</h3>
              <p className="hint">{t("export.lsDyna.units.hint")}</p>
              <div className="field-grid">
                <label>
                  <span className="field-label">{t("export.lsDyna.mass")}</span>
                  <SafeNumberInput value={settings.mass} onChange={(v) => update("mass", v)} />
                </label>
                <label>
                  <span className="field-label">{t("export.lsDyna.length")}</span>
                  <SafeNumberInput value={settings.length} onChange={(v) => update("length", v)} />
                </label>
                <label>
                  <span className="field-label">{t("export.lsDyna.time")}</span>
                  <SafeNumberInput value={settings.time} onChange={(v) => update("time", v)} />
                </label>
              </div>
            </>
          )}
        </section>

        <section className="panel module-result">
          <h2>{t("export.preview.title")}</h2>
          {error ? (
            <p className="error">{error}</p>
          ) : (
            <>
              <button type="button" className="primary" onClick={download} disabled={!deck}>
                <Download size={16} aria-hidden="true" />
                {t("export.download")}
              </button>
              <pre className="deck-preview" aria-label={t("export.preview.title")}>
                {deck ?? ""}
              </pre>
            </>
          )}
        </section>
      </div>
    </>
  );
}
