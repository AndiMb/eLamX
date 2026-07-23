import { Link, useLocation } from "react-router-dom";
import { Diamond, Layers, Ruler, type LucideIcon } from "lucide-react";

// Custom active-matching (not NavLink's own isActive): the "Laminate" tab
// must stay highlighted while drilled into a laminate's detail or module
// screen too, not just at the exact list route "/".
const TABS: { to: string; label: string; icon: LucideIcon; match: (p: string) => boolean }[] = [
  { to: "/", label: "Laminate", icon: Layers, match: (p) => p === "/" || p.startsWith("/laminates") },
  { to: "/materials", label: "Materialien", icon: Diamond, match: (p) => p.startsWith("/materials") },
  { to: "/settings/format", label: "Einstellungen", icon: Ruler, match: (p) => p.startsWith("/settings") },
];

export function BottomTabs() {
  const { pathname } = useLocation();
  return (
    <nav className="bottom-tabs">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link key={tab.to} to={tab.to} className={`bottom-tab${tab.match(pathname) ? " active" : ""}`}>
            <Icon size={20} strokeWidth={1.75} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
