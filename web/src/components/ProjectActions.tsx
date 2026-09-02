import { useCallback, useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { FolderOpen, Save } from "lucide-react";
import { downloadProject, exportProject, importProject } from "../lib/projectFile";
import { desktop, type DesktopProject } from "../lib/desktop";
import {
  loadProjectAtom,
  projectFilePathAtom,
  projectNameAtom,
  projectSnapshotAtom,
} from "../store/projectAtoms";
import { useLocale, useT } from "../i18n";

// Opening and saving `.elamx` files, in the top bar's reserved file slot.
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
  const [projectName, setProjectName] = useAtom(projectNameAtom);
  const [filePath, setFilePath] = useAtom(projectFilePathAtom);
  const [error, setError] = useState<string | null>(null);
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
        loadProject(await importProject(project.xml));
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
    load({ xml: await file.text(), name: file.name.replace(/\.elamx$/i, "") });

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

  // The native menu does not act on its own: it asks for the same two actions
  // the buttons run, so there is one implementation of each.
  useEffect(() => {
    if (!shell) return;
    const stopCommands = shell.onCommand((command) => {
      if (command === "open") void open();
      else void save(command === "saveAs");
    });
    const stopOpened = shell.onProjectOpened((project) => void load(project));
    // Only now can a double-clicked file be delivered - before this there was
    // nobody to deliver it to.
    if (!announced.current) {
      announced.current = true;
      shell.ready();
    }
    return () => {
      stopCommands();
      stopOpened();
    };
  }, [shell, open, save, load]);

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
          accept=".elamx,application/xml,text/xml"
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
      </div>
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
