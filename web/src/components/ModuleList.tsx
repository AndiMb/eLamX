import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { MODULE_LIST } from "../lib/moduleRegistry";

// Module rows rendered from MODULE_REGISTRY, shown on the laminate page on
// BOTH desktop and mobile (UI-Konzept §7): on mobile it is the only way to
// reach a module (no sidebar tree), on desktop it makes modules discoverable
// for beginners who don't know the tree yet. A new module registered in
// MODULE_REGISTRY appears here automatically.
export function ModuleList({ laminateId }: { laminateId: string }) {
  return (
    <>
      <h3>Module</h3>
      <ul className="module-list">
        {MODULE_LIST.map((mod) => {
          const Icon = mod.icon;
          return (
            <li key={mod.id}>
              <Link className="module-row" to={`/laminates/${laminateId}/modules/${mod.id}`}>
                <Icon size={20} strokeWidth={1.75} />
                <span className="module-text">
                  <div>{mod.label}</div>
                  <div className="module-desc">{mod.description}</div>
                </span>
                <ChevronRight size={16} className="chevron" />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
