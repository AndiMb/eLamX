import { useAtom } from "jotai";
import { GraduationCap, Moon, Sun } from "lucide-react";
import { studentModeAtom, themeAtom } from "../store/settingsAtoms";

// Stylized layer stack as the logo mark - inline SVG, no asset. Staggered
// parallelograms (not equal full-width bars, which would read as a hamburger
// menu icon and falsely suggest a navigation drawer).
function LogoMark() {
  return (
    <span className="topbar-logo" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M6 3 L18 3 L14 7.2 L2 7.2 Z" fill="currentColor" opacity="0.9" />
        <path d="M6 8.4 L18 8.4 L14 12.6 L2 12.6 Z" fill="currentColor" opacity="0.6" />
        <path d="M6 13.8 L18 13.8 L14 18 L2 18 Z" fill="currentColor" opacity="0.35" />
      </svg>
    </span>
  );
}

// Slim app bar (UI-Konzept §4). The empty .topbar-file-slot is the reserved
// home for future file actions (Neu/Oeffnen/Speichern/Export/Schnappschuss)
// once the persistence phase lands - deliberately kept in the DOM so the
// layout doesn't shift when they arrive.
export function TopBar({ title }: { title?: string }) {
  const [studentMode, setStudentMode] = useAtom(studentModeAtom);
  const [theme, setTheme] = useAtom(themeAtom);

  // The toggle cycles the *effective* look; "system" resolves to whatever the
  // OS currently prefers, so the first click always visibly flips.
  const systemPrefersDark =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effectiveDark = theme === "dark" || (theme === "system" && systemPrefersDark);

  return (
    <header className="topbar">
      <span className="topbar-brand">
        <LogoMark />
        eLamX
      </span>
      {title && <span className="topbar-title">{title}</span>}
      <div className="topbar-actions">
        <div className="topbar-file-slot" />
        <button
          type="button"
          className={`student-pill${studentMode ? " active" : ""}`}
          onClick={() => setStudentMode((v) => !v)}
          title="Erklär-Panels standardmäßig aufklappen"
        >
          <GraduationCap size={16} strokeWidth={1.75} />
          Studierenden-Modus
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => setTheme(effectiveDark ? "light" : "dark")}
          aria-label={effectiveDark ? "Helles Design" : "Dunkles Design"}
          title={effectiveDark ? "Helles Design" : "Dunkles Design"}
        >
          {effectiveDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
