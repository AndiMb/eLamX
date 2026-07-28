import { useEffect } from "react";
import { useLocale, translate } from "./index";

// Stamps the active language onto the document: <html lang> is what screen
// readers use to pick a pronunciation and what the browser uses for
// hyphenation, and the tab title is the one piece of UI text that lives
// outside React's tree.
export function useApplyLocale() {
  const locale = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, "app.title");
  }, [locale]);
}
