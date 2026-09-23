import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useStore } from "jotai";
import { FileText, Save, Trash2 } from "lucide-react";
import { SECTION_KINDS, type ReportTemplate, type SectionKind } from "../lib/report/model";
import { reportDraftAtom, reportTemplatesAtom } from "../store/reportAtoms";
import { projectNameAtom, projectSnapshotAtom } from "../store/projectAtoms";
import { activeLoadCaseFamily } from "../store/laminateAtoms";
import { studyResultsFamily } from "../store/studyAtoms";
import { formatConfigFamily } from "../store/formatAtoms";
import { failureMetricAtom } from "../store/settingsAtoms";
import { saveFile } from "../lib/saveFile";
import { useLocale, useT, type MessageKey } from "../i18n";
import type { ReportStage } from "../lib/report/generate";

// The report dialog (F3.2): what goes in, for which laminates and load cases,
// how detailed, on which paper, by whom - then the PDF. The settings are
// remembered for the next report, and can be saved under a name in the
// project, where they travel with the file.
//
// The report is made on the main thread, in steps that yield to the page, so
// the progress bar moves; the heavy part (jsPDF, svg2pdf, MathJax) is loaded
// only now, from the report's own chunk.

const SECTION_KEYS: Record<SectionKind, MessageKey> = {
  materials: "report.section.materials",
  laminate: "report.layup.title",
  abd: "report.section.abd",
  loadCases: "report.section.loadCases",
  layerResults: "report.dialog.section.layerResults",
  failureSequence: "lpf.sequence.title",
  buckling: "report.section.buckling",
  vibration: "report.section.vibration",
  deformation: "report.section.deformation",
  comparison: "compare.title",
  studies: "report.section.studies",
};

const STAGE_KEYS: Record<ReportStage, MessageKey> = {
  compute: "report.dialog.stage.compute",
  figures: "report.dialog.stage.figures",
  pdf: "report.dialog.stage.pdf",
};

function fileName(project: string): string {
  const base = project.replace(/[\\/:*?"<>|]+/g, "-").trim() || "eLamX";
  return `${base}-report.pdf`;
}

export function ReportDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const store = useStore();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useAtom(reportDraftAtom);
  const [templates, setTemplates] = useAtom(reportTemplatesAtom);
  const projectName = useAtomValue(projectNameAtom);
  const laminates = useAtomValue(projectSnapshotAtom).laminates;
  const [progress, setProgress] = useState<{ stage: ReportStage; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  const update = <K extends keyof ReportTemplate>(key: K, value: ReportTemplate[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const toggleSection = (kind: SectionKind) =>
    update(
      "sections",
      draft.sections.includes(kind)
        ? draft.sections.filter((s) => s !== kind)
        : SECTION_KINDS.filter((k) => k === kind || draft.sections.includes(k)),
    );
  const selectedLaminates = draft.laminates.filter((id) => laminates.some((l) => l.id === id));
  const toggleLaminate = (id: string) => {
    const current = selectedLaminates.length === 0 ? laminates.map((l) => l.id) : selectedLaminates;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    // All of them is stored as none, so a laminate added later is in too.
    update("laminates", next.length === laminates.length ? [] : next);
  };
  const isLaminateOn = (id: string) => selectedLaminates.length === 0 || selectedLaminates.includes(id);
  const busy = progress !== null;
  const nothing = draft.sections.length === 0 || (selectedLaminates.length === 0 && draft.laminates.length > 0);

  const generate = async () => {
    setError(null);
    setProgress({ stage: "compute", done: 0, total: 1 });
    try {
      const { generateReport } = await import("../lib/report/generate");
      const project = store.get(projectSnapshotAtom);
      const template = { ...draft, laminates: selectedLaminates };
      const blob = await generateReport({
        template,
        project,
        activeLoadCase: (id) => store.get(activeLoadCaseFamily(id)).id,
        cachedStudy: (id, hash) => {
          const run = store.get(studyResultsFamily(id));
          return run && run.status === "done" && run.hash === hash ? run.points : null;
        },
        ctx: {
          t,
          locale,
          formats: (c) => store.get(formatConfigFamily(c)),
          metric: store.get(failureMetricAtom),
          detail: draft.detail,
        },
        info: {
          projectName,
          author: draft.author,
          date: new Date(),
          version: `${import.meta.env.VITE_ELAMX_VERSION ?? "dev"} (${import.meta.env.VITE_ELAMX_BUILD ?? "dev"})`,
        },
        onProgress: (stage, done, total) => setProgress({ stage, done, total }),
      });
      await saveFile(blob, fileName(projectName), ["pdf"]);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    const template = { ...draft, name, laminates: selectedLaminates };
    setTemplates((list) => [...list.filter((x) => x.name !== name), template]);
    setTemplateName("");
  };

  return (
    <dialog
      ref={dialog}
      className="app-dialog report-dialog"
      aria-labelledby="report-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void generate();
        }}
      >
        <h2 id="report-dialog-title">
          <FileText size={16} strokeWidth={1.75} />
          {t("report.dialog.title")}
        </h2>

        {templates.length > 0 && (
          <div className="report-templates">
            <label>
              <span>{t("report.dialog.template")}</span>
              <select
                value=""
                disabled={busy}
                onChange={(e) => {
                  const chosen = templates.find((x) => x.name === e.target.value);
                  if (chosen) setDraft({ ...chosen });
                }}
              >
                <option value="">{t("report.dialog.template.pick")}</option>
                {templates.map((x) => (
                  <option key={x.name} value={x.name}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            {templates.some((x) => x.name === draft.name) && (
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                title={t("report.dialog.template.delete", { name: draft.name })}
                aria-label={t("report.dialog.template.delete", { name: draft.name })}
                onClick={() => setTemplates((list) => list.filter((x) => x.name !== draft.name))}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )}

        <fieldset disabled={busy}>
          <legend>{t("report.dialog.sections")}</legend>
          <div className="report-checks">
            {SECTION_KINDS.map((kind) => (
              <label key={kind} className="inline-check">
                <input type="checkbox" checked={draft.sections.includes(kind)} onChange={() => toggleSection(kind)} />
                {t(SECTION_KEYS[kind])}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={busy}>
          <legend>{t("report.dialog.scope")}</legend>
          <div className="report-checks">
            {laminates.map((l) => (
              <label key={l.id} className="inline-check">
                <input type="checkbox" checked={isLaminateOn(l.id)} onChange={() => toggleLaminate(l.id)} />
                {l.name}
              </label>
            ))}
          </div>
          <div className="segmented" role="radiogroup" aria-label={t("report.header.loadCases")}>
            {(["active", "all"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={draft.loadCases === v}
                className={draft.loadCases === v ? "active" : undefined}
                onClick={() => update("loadCases", v)}
              >
                {t(v === "active" ? "report.dialog.loadCases.active" : "report.dialog.loadCases.all")}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={busy} className="report-options">
          <legend>{t("report.dialog.options")}</legend>
          <div className="segmented" role="radiogroup" aria-label={t("report.header.detail")}>
            {(["results", "derivation"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={draft.detail === v}
                className={draft.detail === v ? "active" : undefined}
                onClick={() => update("detail", v)}
              >
                {t(v === "results" ? "report.detail.results" : "report.detail.derivation")}
              </button>
            ))}
          </div>
          <label>
            <span>{t("report.dialog.paper")}</span>
            <select value={draft.paper} onChange={(e) => update("paper", e.target.value as ReportTemplate["paper"])}>
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
            </select>
          </label>
          <label>
            <span>{t("report.header.author")}</span>
            <input type="text" value={draft.author} onChange={(e) => update("author", e.target.value)} />
          </label>
          <label className="inline-check">
            <input type="checkbox" checked={draft.signature} onChange={(e) => update("signature", e.target.checked)} />
            {t("report.dialog.signature")}
          </label>
        </fieldset>

        <div className="report-save-template">
          <input
            type="text"
            value={templateName}
            disabled={busy}
            placeholder={t("report.dialog.template.name")}
            aria-label={t("report.dialog.template.name")}
            onChange={(e) => setTemplateName(e.target.value)}
          />
          <button type="button" disabled={busy || !templateName.trim()} onClick={saveTemplate}>
            <Save size={14} /> {t("report.dialog.template.save")}
          </button>
        </div>

        {progress && (
          <div className="report-progress" role="status">
            <span>
              {t(STAGE_KEYS[progress.stage])} ({progress.done}/{progress.total})
            </span>
            <progress
              max={3}
              value={
                ["compute", "figures", "pdf"].indexOf(progress.stage) + (progress.total > 0 ? progress.done / progress.total : 0)
              }
            />
          </div>
        )}
        {error && <p className="error">{t("report.dialog.error", { message: error })}</p>}

        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            {t("paste.cancel")}
          </button>
          <button type="submit" className="btn-primary" disabled={busy || nothing}>
            {t("report.dialog.generate")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
