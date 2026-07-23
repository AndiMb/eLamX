import { useMemo } from "react";
import katex from "katex";

// Minimal replacement for react-katex: that package pulls in its own nested
// katex@0.16.47 dependency (separate from the katex@0.17.0 this project
// installs directly), and the resulting duplicate-package situation broke
// Vite's dependency pre-bundling badly enough that formulas rendered with
// mangled/truncated macro names (e.g. "\dfrac{a}{b}" -> stray red "\d" error
// tokens plus literal "frac", braces dropped) - reproducible even after
// clearing Vite's cache and forcing `optimizeDeps.include: ['katex']`. Since
// react-katex is a ~15-line wrapper around `katex.renderToString`, calling
// that directly removes the duplicate dependency (and the bug) entirely.
// KaTeX's output HTML is safe to inject here: the inputs are always our own
// authored formula strings, never user-supplied text.
function useKatexHtml(math: string, displayMode: boolean): string {
  return useMemo(() => {
    try {
      return katex.renderToString(math, { displayMode, throwOnError: false });
    } catch (error) {
      return `<span class="katex-error">${String(error)}</span>`;
    }
  }, [math, displayMode]);
}

export function BlockMath({ math }: { math: string }) {
  const html = useKatexHtml(math, true);
  // eslint-disable-next-line react/no-danger
  return <div className="katex-block" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function InlineMath({ math }: { math: string }) {
  const html = useKatexHtml(math, false);
  // eslint-disable-next-line react/no-danger
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
