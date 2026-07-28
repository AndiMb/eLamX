import { Link, useLocation } from "react-router-dom";
import { Diamond, Layers, Ruler, type LucideIcon } from "lucide-react";
import { useT, type MessageKey } from "../i18n";

// Custom active-matching (not NavLink's own isActive): the "Laminate" tab
// must stay highlighted while drilled into a laminate's detail or module
// screen too, not just at the exact list route "/".
const TABS: { to: string; labelKey: MessageKey; icon: LucideIcon; match: (p: string) => boolean }[] = [
  { to: "/", labelKey: "nav.laminates", icon: Layers, match: (p) => p === "/" || p.startsWith("/laminates") },
  { to: "/materials", labelKey: "nav.materials", icon: Diamond, match: (p) => p.startsWith("/materials") },
  { to: "/settings/format", labelKey: "nav.settings", icon: Ruler, match: (p) => p.startsWith("/settings") },
];

export function BottomTabs() {
  const t = useT();
  const { pathname } = useLocation();
  return (
    <nav className="bottom-tabs">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        return (
          <Link key={tab.to} to={tab.to} className={`bottom-tab${tab.match(pathname) ? " active" : ""}`}>
            <Icon size={20} strokeWidth={1.75} />
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
