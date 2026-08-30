import { useEffect, useState, type ReactNode } from "react";
import { NARROW_QUERY } from "../lib/breakpoints";

// Puts a heavyweight panel behind a deliberate action on a narrow screen, and
// leaves it exactly as it was on anything wider.
//
// The measurement behind it: a CLT page was about five screen heights on a
// phone, and the ABD matrix, the heatmap, the angle sweep and the
// through-thickness charts accounted for most of that. They are worth having -
// just not in the scroll path between a load and its answer. A <details> is
// the whole mechanism: no state, no animation, and it stays open once opened.
//
// The threshold is wider than the shell's own mobile breakpoint, deliberately:
// the shell switches where the TREE stops fitting, this switches where the
// CONTENT does. A portrait tablet gets the desktop shell and still cannot put
// the equation side by side or a heatmap next to a sweep, so it has the
// phone's scrolling problem. Laptops keep everything. See lib/breakpoints.ts.

export function MobileCollapse({
  title,
  children,
  disabled = false,
}: {
  title: string;
  children: ReactNode;
  /** Leaves the children where they are, at any width. For a panel that is
   *  usually output and occasionally input - hiding a field someone has to
   *  fill in is worse than a long page. */
  disabled?: boolean;
}) {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const handler = () => setNarrow(query.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  if (!narrow || disabled) return <>{children}</>;

  return (
    <details className="mobile-collapse">
      <summary>{title}</summary>
      {children}
    </details>
  );
}
