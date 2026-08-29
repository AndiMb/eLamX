import { useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Plus, X } from "lucide-react";
import {
  activeLoadCaseFamily,
  addLoadCaseAtom,
  laminateConfigFamily,
  loadCasesOf,
  removeLoadCaseAtom,
  selectedLoadCaseFamily,
} from "../store/laminateAtoms";
import { useT } from "../i18n";

// The load cases of one laminate, as a row of pills. This is the object the
// original called "Berechnung" / "Berechnung2" and the file format has always
// stored as several <calculation> elements; the web version used to hold
// exactly one and carry the rest through invisibly.
//
// Double-click renames, as in the laminate tree. Adding copies the active case
// rather than starting blank: a second load case is nearly always a variation
// of the one on screen.
export function LoadCaseBar({ laminateId }: { laminateId: string }) {
  const t = useT();
  const [config, setConfig] = useAtom(laminateConfigFamily(laminateId));
  const active = useAtomValue(activeLoadCaseFamily(laminateId));
  const setSelected = useSetAtom(selectedLoadCaseFamily(laminateId));
  const addLoadCase = useSetAtom(addLoadCaseAtom);
  const removeLoadCase = useSetAtom(removeLoadCaseAtom);
  const [renaming, setRenaming] = useState<string | null>(null);

  const cases = loadCasesOf(config);

  const commitRename = (id: string, name: string) => {
    const trimmed = name.trim();
    if (trimmed) {
      setConfig((c) => ({
        ...c,
        loadCases: loadCasesOf(c).map((lc) => (lc.id === id ? { ...lc, name: trimmed } : lc)),
      }));
    }
    setRenaming(null);
  };

  return (
    <div className="load-case-bar">
      <span className="load-case-label">{t("loadCase.label")}</span>
      {cases.map((loadCase) => {
        const isActive = loadCase.id === active.id;
        return (
          <span
            key={loadCase.id}
            className={`load-case-pill${isActive ? " active" : ""}`}
            onDoubleClick={() => setRenaming(loadCase.id)}
          >
            {renaming === loadCase.id ? (
              <input
                autoFocus
                defaultValue={loadCase.name}
                onBlur={(e) => commitRename(loadCase.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(loadCase.id, e.currentTarget.value);
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <>
                <button type="button" onClick={() => setSelected(loadCase.id)}>
                  {loadCase.name}
                </button>
                {isActive && cases.length > 1 && (
                  <button
                    type="button"
                    className="load-case-remove"
                    onClick={() => removeLoadCase({ laminateId, loadCaseId: loadCase.id })}
                    title={t("loadCase.remove")}
                    aria-label={t("loadCase.remove")}
                  >
                    <X size={12} />
                  </button>
                )}
              </>
            )}
          </span>
        );
      })}
      <button
        type="button"
        className="icon-button"
        onClick={() => addLoadCase(laminateId)}
        title={t("loadCase.add")}
        aria-label={t("loadCase.add")}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
