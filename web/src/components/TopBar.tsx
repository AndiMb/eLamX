import { useAtom } from "jotai";
import { GraduationCap, Languages, Moon, Sun } from "lucide-react";
import { studentModeAtom, themeAtom } from "../store/settingsAtoms";
import { LOCALES, useLocale, useSetLocale, useT, type Locale } from "../i18n";
import { ProjectActions } from "./ProjectActions";

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

// A native <select> rather than a custom dropdown: it is the one control that
// must be usable BEFORE the user can read the UI (they may be looking at a
// language they don't speak), and the platform picker is the widget every
// user already recognizes - on mobile it also opens as a native wheel/sheet.
// The options name themselves ("Deutsch", "English"), never "German".
function LanguagePicker() {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();

  return (
    <label className="language-picker" title={t("topbar.language")}>
      <Languages size={16} strokeWidth={1.75} aria-hidden="true" />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        aria-label={t("topbar.language")}
      >
        {LOCALES.map((l) => (
          <option key={l.id} value={l.id}>
            {l.short}
          </option>
        ))}
      </select>
    </label>
  );
}

// Slim app bar. The file slot holds opening and saving of .elamx projects;
// everything else in the session persists itself to browser storage, so the
// file actions are for moving work OUT of the browser, not for keeping it.
export function TopBar({ title }: { title?: string }) {
  const t = useT();
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
        <ProjectActions />
        <button
          type="button"
          className={`student-pill${studentMode ? " active" : ""}`}
          onClick={() => setStudentMode((v) => !v)}
          title={t("topbar.studentMode.hint")}
          aria-label={t("topbar.studentMode")}
        >
          <GraduationCap size={16} strokeWidth={1.75} />
          {/* Label collapses to the icon alone on narrow phones - the top bar
              gained a third control and "Studierenden-Modus" is the longest
              string competing for that row. */}
          <span className="student-pill-text">{t("topbar.studentMode")}</span>
        </button>
        <LanguagePicker />
        <button
          type="button"
          className="icon-button"
          onClick={() => setTheme(effectiveDark ? "light" : "dark")}
          aria-label={effectiveDark ? t("topbar.theme.light") : t("topbar.theme.dark")}
          title={effectiveDark ? t("topbar.theme.light") : t("topbar.theme.dark")}
        >
          {effectiveDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
