import { useEffect, useState } from "react";

// One shell-level branch (see App.tsx), not scattered individual checks -
// per the architecture plan, the mobile/desktop decision belongs at the
// shell, not sprinkled through every component.
export const MOBILE_BREAKPOINT_QUERY = "(max-width: 640px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const handler = () => setIsMobile(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isMobile;
}
