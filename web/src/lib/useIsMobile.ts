import { useEffect, useState } from "react";
import { MOBILE_QUERY } from "./breakpoints";

// One shell-level branch (see App.tsx), not scattered individual checks -
// per the architecture plan, the mobile/desktop decision belongs at the
// shell, not sprinkled through every component.
// Re-exported for the call sites that already import it from here; the value
// itself lives with the other three in lib/breakpoints.ts.
export { MOBILE_QUERY as MOBILE_BREAKPOINT_QUERY } from "./breakpoints";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const handler = () => setIsMobile(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isMobile;
}
