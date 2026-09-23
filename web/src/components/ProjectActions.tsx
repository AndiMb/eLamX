import { useCallback, useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { FilePlus, FileText, FolderOpen, Save } from "lucide-react";
import { downloadProject, exportProject, importProject } from "../lib/projectFile";
import type { ProjectFormat } from "../lib/projectFile";
import { desktop, type DesktopProject } from "../lib/desktop";
import { registerCommand, runCommand } from "../lib/commands";
import type { ImportNotice } from "../lib/webExtension";
import { criterionName } from "../lib/types";
import {
  importNoticesAtom,
  loadProjectAtom,
  newProjectAtom,
  projectFilePathAtom,
  projectNameAtom,
  projectSnapshotAtom,
} from "../store/projectAtoms";
import { useLocale, useT } from "../i18n";

// Opening and saving `.elamx` files, in the top bar's reserved file slot.
//
// `.elamxb` opens too, and only opens: it is the batch mode's INPUT shorthand,
// the original has no writer for it either, and a project saved from here is a
// project rather than the question that produced it.

/** Which reader a file needs, by its name. The extension is the whole signal -
 *  both formats are `<elamx>` documents, and the original's batch mode asks for
 *  the reduced one with a switch rather than by looking. */
function formatOf(name: string): ProjectFormat {
  return /\.elamxb$/i.test(name) ? "reduced" : "project";
}

/** One notice as a sentence. */
function noticeText(notice: ImportNotice, t: ReturnType<typeof useT>): string {
  switch (notice.kind) {
    case "unknown_web_extension_schema":
      return t("project.notice.unknownWebExtensionSchema", { schema: notice.schema });
    case "invalid_web_extension":
      return t("project.notice.invalidWebExtension", { message: notice.message });
    case "comparison_variant_dropped":
      return t("project.notice.comparisonVariantDropped", {
        laminate: notice.laminate,
        loadCase: notice.loadCase,
      });
    case "stale_layer_criteria": {
      const criteria = notice.extra.map((id) => criterionName(id, t)).join(", ");
      return notice.reason === "criterion_changed" && notice.layer !== null
        ? t("project.notice.staleLayerCriteria.changed", {
            laminate: notice.laminate,
            layer: notice.layer,
            criteria,
          })
        : t("project.notice.staleLayerCriteria.missing", { laminate: notice.laminate, criteria });
    }
    case "unknown_layer_criterion":
      return t("project.notice.unknownLayerCriterion", {
        laminate: notice.laminate,
        layer: notice.layer,
        criterion: notice.criterion,
      });
  }
}
//
// Two paths, one set of buttons. In a browser it is a hidden <input
// type="file"> driven by a real button, rather than the File System Access
// API: showOpenFilePicker() exists only in Chromium, and this has to work on
// the phone and in Firefox and Safari too. The cost is that "Save" downloads a
// fresh copy instead of writing back to the file that was opened - which the
// browser does not permit portably anyway.
//
// In the desktop shell that cost disappears: the system dialog hands over a
// path, and Save writes to it. The path is the only new piece of state, and it
// is what tells the two apart - `desktop()` is null in a tab, and everything
// below falls back to the download.
export function ProjectActions() {
  const t = useT();
  const locale = useLocale();
  const fileInput = useRef<HTMLInputElement>(null);
  // The effect below re-runs whenever its callbacks change; announcing more
  // than once is harmless but pointless, and the main process would have to
  // keep guarding against a second delivery.
  const announced = useRef(false);
  const snapshot = useAtomValue(projectSnapshotAtom);
  const loadProject = useSetAtom(loadProjectAtom);
  const newProject = useSetAtom(newProjectAtom);
  const [projectName, setProjectName] = useAtom(projectNameAtom);
  const [filePath, setFilePath] = useAtom(projectFilePathAtom);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useAtom(importNoticesAtom);
  const [busy, setBusy] = useState(false);
  const shell = desktop();

  const report = (e: unknown) => {
    // The core names the offending element, which is far more useful than a
    // generic "invalid file" - so show its message rather than replacing it.
    setError(e instanceof Error ? e.message : String(e));
  };

  const load = useCallback(
    async (project: DesktopProject | { xml: string; name: string; filePath?: string }) => {
      setBusy(true);
      setError(null);
      try {
        loadProject(await importProject(project.xml, formatOf(project.name)));
        setProjectName(project.name);
        setFilePath(project.filePath ?? null);
      } catch (e) {
        report(e);
      } finally {
        setBusy(false);
      }
    },
    [loadProject, setProjectName, setFilePath],
  );

  const openFromBrowser = async (file: File) =>
    load({ xml: await file.text(), name: file.name.replace(/\.elamxb?$/i, "") });

  const open = useCallback(async () => {
    if (!shell) {
      fileInput.current?.click();
      return;
    }
    try {
      const project = await shell.openProject(filePath);
      if (project) await load(project);
    } catch (e) {
      report(e);
    }
  }, [shell, filePath, load]);

  const save = useCallback(
    async (askWhere: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const xml = await exportProject(snapshot);
        if (!shell) {
          downloadProject(xml, projectName || "eLamX");
          return;
        }
        const saved = await shell.saveProject(
          xml,
          askWhere ? null : filePath,
          projectName || "eLamX",
        );
        if (saved) {
          setFilePath(saved.filePath);
          setProjectName(saved.name);
        }
      } catch (e) {
        report(e);
      } finally {
        setBusy(false);
      }
    },
    [shell, snapshot, projectName, filePath, setFilePath, setProjectName],
  );

  const startNew = useCallback(() => {
    // Asked, because it is the one change undo cannot take back: a new
    // project starts a new history.
    if (!window.confirm(t("command.newProject.confirm"))) return;
    setError(null);
    newProject();
  }, [newProject, t]);

  // The file actions as commands, so a shortcut, the native menu and the
  // buttons all run the same code. In the shell the menu has the accelerators
  // for these keys and sends the command itself; see `nativeInDesktop`.
  useEffect(() => {
    const unregister = [
      registerCommand({
        id: "file.new",
        label: "command.newProject",
        // No key: Ctrl+N opens a browser window, and a page cannot have it.
        // The desktop menu gives it one.
        when: () => !busy,
        run: startNew,
      }),
      registerCommand({
        id: "file.open",
        label: "topbar.open",
        shortcut: "Mod+O",
        nativeInDesktop: true,
        when: () => !busy,
        run: open,
      }),
      registerCommand({
        id: "file.save",
        label: "topbar.save",
        shortcut: "Mod+S",
        nativeInDesktop: true,
        when: () => !busy,
        run: () => save(false),
      }),
      registerCommand({
        id: "file.saveAs",
        label: "command.saveAs",
        shortcut: "Mod+Shift+S",
        nativeInDesktop: true,
        when: () => !busy,
        run: () => save(true),
      }),
    ];
    return () => unregister.forEach((stop) => stop());
  }, [open, save, startNew, busy]);

  // The menu's commands are routed by useGlobalShortcuts, with the rest of
  // the keys; what stays here is the file the shell hands over.
  useEffect(() => {
    if (!shell) return;
    const stopOpened = shell.onProjectOpened((project) => void load(project));
    // Only now can a double-clicked file be delivered - before this there was
    // nobody to deliver it to.
    if (!announced.current) {
      announced.current = true;
      shell.ready();
    }
    return stopOpened;
  }, [shell, load]);

  // One language setting, not two: the menu is built in the main process,
  // which has none of the app's catalogs.
  useEffect(() => {
    shell?.setLocale(locale);
  }, [shell, locale]);

  return (
    <>
      <div className="topbar-file-slot">
        <input
          ref={fileInput}
          type="file"
          aria-label={t("topbar.open")}
          accept=".elamx,.elamxb,application/xml,text/xml"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset first, so picking the same file twice fires again.
            e.target.value = "";
            if (file) void openFromBrowser(file);
          }}
        />
        <button
          type="button"
          className="icon-button topbar-new"
          onClick={() => runCommand("file.new")}
          disabled={busy}
          title={t("command.newProject")}
          aria-label={t("command.newProject")}
        >
          <FilePlus size={18} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => void open()}
          disabled={busy}
          title={t("topbar.open.hint")}
          aria-label={t("topbar.open")}
        >
          <FolderOpen size={18} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => void save(false)}
          disabled={busy}
          title={filePath ? t("topbar.save.toFile", { file: filePath }) : t("topbar.save.hint")}
          aria-label={t("topbar.save")}
        >
          <Save size={18} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => runCommand("report.create")}
          disabled={busy}
          title={t("command.report")}
          aria-label={t("command.report")}
        >
          <FileText size={18} strokeWidth={1.75} />
        </button>
      </div>
      {notices.length > 0 && !error && (
        // What was read but could not be used. Not an error - the project is
        // open - but nothing the user should find out about by its absence.
        <div className="project-error project-notice" role="status">
          <strong>{t("project.notices.title")}</strong>
          {notices.map((notice, i) => (
            <span key={i}>{noticeText(notice, t)}</span>
          ))}
          <button type="button" onClick={() => setNotices([])}>
            {t("project.dismiss")}
          </button>
        </div>
      )}
      {error && (
        <div className="project-error" role="alert">
          <strong>{t("project.readError.title")}</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            {t("project.dismiss")}
          </button>
        </div>
      )}
    </>
  );
}
