import { useEffect, useState, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronRight, GraduationCap } from "lucide-react";
import { BlockMath } from "./Math";
import { studentModeAtom } from "../store/settingsAtoms";
import { useT } from "../i18n";

interface HowWasThisComputedProps {
  title: string;
  /** Static, symbolic KaTeX source - the textbook-style formula. */
  formula: string;
  /** The same formula with the laminate's actual current numbers plugged in. */
  substituted?: string;
  /** Extra prose, or a pointer to where the raw data lives (e.g. "see the table above"). */
  children?: ReactNode;
}

// Collapsed by default in "Ingenieur-Modus" (quick productive checks),
// expanded by default in "Studierenden-Modus" (lecture demos / learning CLT)
// - see the global toggle in the sidebar's Einstellungen section
// (settingsAtoms.ts). Flipping that global switch resyncs every already-open
// or -closed panel to the new default; a panel the user has individually
// toggled since then keeps that override until the global switch flips again.
export function HowWasThisComputed({ title, formula, substituted, children }: HowWasThisComputedProps) {
  const t = useT();
  const studentMode = useAtomValue(studentModeAtom);
  const [open, setOpen] = useState(studentMode);

  useEffect(() => {
    setOpen(studentMode);
  }, [studentMode]);

  return (
    <div className="how-computed">
      <button type="button" className="how-computed-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <GraduationCap size={14} strokeWidth={1.75} />
        {t("howComputed.toggle", { title })}
      </button>
      {open && (
        <div className="how-computed-body">
          <BlockMath math={formula} />
          {substituted && (
            <>
              <p className="hint">{t("howComputed.withValues")}</p>
              <BlockMath math={substituted} />
            </>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
