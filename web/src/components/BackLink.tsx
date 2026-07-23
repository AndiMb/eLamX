import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useIsMobile } from "../lib/useIsMobile";

// Desktop navigates via the always-visible sidebar tree, so it never needs
// this; mobile has no persistent tree, so each detail screen needs an
// explicit way back up one level beyond relying on the hardware/browser back
// gesture alone.
export function BackLink({ to, label }: { to: string; label: string }) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;
  return (
    <Link to={to} className="back-link">
      <ArrowLeft size={16} strokeWidth={1.75} /> {label}
    </Link>
  );
}
