import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { modulePath, modulesOfScope, type ModuleScope } from "../lib/moduleRegistry";
import { useT } from "../i18n";

// Module rows rendered from MODULE_REGISTRY, shown on BOTH desktop and mobile
// (UI-Konzept §7): on mobile it is the only way to reach a module (no sidebar
// tree), on desktop it makes modules discoverable for beginners who don't know
// the tree yet. A new module registered in MODULE_REGISTRY appears here
// automatically - now on whichever page owns its scope, so a material page
// lists material modules and a laminate page laminate ones.
export function ModuleList({ scope, ownerId }: { scope: ModuleScope; ownerId?: string }) {
  const t = useT();
  const modules = modulesOfScope(scope);
  if (modules.length === 0) return null;

  return (
    <section className="panel">
      <h2>{t("modules.title")}</h2>
      <ul className="module-list">
        {modules.map((mod) => {
          const Icon = mod.icon;
          return (
            <li key={mod.id}>
              <Link className="module-row" to={modulePath(mod, ownerId)}>
                <Icon size={20} strokeWidth={1.75} />
                <span className="module-text">
                  <div>{t(mod.labelKey)}</div>
                  <div className="module-desc">{t(mod.descriptionKey)}</div>
                </span>
                <ChevronRight size={16} className="chevron" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
