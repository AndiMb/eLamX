import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { Redo2, Undo2 } from "lucide-react";
import { formatShortcut, isMacPlatform, registerCommand, runCommand } from "../lib/commands";
import { historyAtom, redoLabel, redoProject, undoLabel, undoProject } from "../lib/history";
import { useLocale, useT } from "../i18n";

const UNDO_KEYS = ["Mod+Z"];
// Ctrl+Y is the Windows convention and Ctrl+Shift+Z everyone else's; both
// work everywhere, and the one shown is the platform's own.
const REDO_KEYS = isMacPlatform() ? ["Mod+Shift+Z", "Mod+Y"] : ["Mod+Y", "Mod+Shift+Z"];

// Undo and redo in the top bar, where they are on the phone too - the
// requirement is buttons there rather than a shake or a swipe, which nobody
// finds and everybody triggers by accident.
export function HistoryButtons() {
  const t = useT();
  const locale = useLocale();
  const history = useAtomValue(historyAtom);
  const undoWhat = history ? undoLabel(history) : null;
  const redoWhat = history ? redoLabel(history) : null;

  // The commands live here, next to what shows their state; the history
  // itself runs from the app's root whether or not this is mounted.
  useEffect(() => {
    const stops = [
      registerCommand({
        id: "edit.undo",
        label: "command.undo",
        shortcut: UNDO_KEYS,
        nativeInDesktop: true,
        run: () => void undoProject(),
      }),
      registerCommand({
        id: "edit.redo",
        label: "command.redo",
        shortcut: REDO_KEYS,
        nativeInDesktop: true,
        run: () => void redoProject(),
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }, []);

  const isMac = isMacPlatform();
  const hint = (label: string, keys: string[]) => `${label} (${formatShortcut(keys[0], isMac, locale)})`;
  const undoText = undoWhat ? t("command.undo.what", { what: undoWhat }) : t("command.undo");
  const redoText = redoWhat ? t("command.redo.what", { what: redoWhat }) : t("command.redo");

  return (
    <div className="topbar-history">
      <button
        type="button"
        className="icon-button"
        onClick={() => runCommand("edit.undo")}
        disabled={undoWhat === null}
        title={hint(undoText, UNDO_KEYS)}
        aria-label={undoText}
      >
        <Undo2 size={18} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={() => runCommand("edit.redo")}
        disabled={redoWhat === null}
        title={hint(redoText, REDO_KEYS)}
        aria-label={redoText}
      >
        <Redo2 size={18} strokeWidth={1.75} />
      </button>
    </div>
  );
}
