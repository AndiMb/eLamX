import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { themeAtom } from "../store/settingsAtoms";

// Stamps the persisted theme choice onto <html> so the CSS token scopes in
// index.css can react to it. "system" removes the attribute entirely, letting
// the prefers-color-scheme media query decide.
export function useApplyTheme() {
  const theme = useAtomValue(themeAtom);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);
}
