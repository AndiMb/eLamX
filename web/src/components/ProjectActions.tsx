import { useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { FolderOpen, Save } from "lucide-react";
import { downloadProject, exportProject, importProject } from "../lib/projectFile";
import {
  loadProjectAtom,
  projectNameAtom,
  projectSnapshotAtom,
} from "../store/projectAtoms";
import { useT } from "../i18n";

// Opening and saving `.elamx` files, in the top bar's reserved file slot.
//
// A hidden <input type="file"> driven by a real button, rather than the File
// System Access API: showOpenFilePicker() exists only in Chromium, and this
// has to work on the phone and in Firefox and Safari too. The cost is that
// "Save" always downloads a fresh copy instead of writing back to the file
// that was opened - which the browser does not permit portably anyway.
export function ProjectActions() {
  const t = useT();
  const fileInput = useRef<HTMLInputElement>(null);
  const snapshot = useAtomValue(projectSnapshotAtom);
  const loadProject = useSetAtom(loadProjectAtom);
  const setProjectName = useSetAtom(projectNameAtom);
  const projectName = useAtomValue(projectNameAtom);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const project = await importProject(await file.text());
      loadProject(project);
      setProjectName(file.name.replace(/\.elamx$/i, ""));
    } catch (e) {
      // The core names the offending element, which is far more useful than a
      // generic "invalid file" - so show its message rather than replacing it.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      downloadProject(await exportProject(snapshot), projectName || "eLamX");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="topbar-file-slot">
        <input
          ref={fileInput}
          type="file"
          accept=".elamx,application/xml,text/xml"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset first, so picking the same file twice fires again.
            e.target.value = "";
            if (file) void open(file);
          }}
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          title={t("topbar.open.hint")}
          aria-label={t("topbar.open")}
        >
          <FolderOpen size={18} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => void save()}
          disabled={busy}
          title={t("topbar.save.hint")}
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
