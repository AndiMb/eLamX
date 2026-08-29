import { Link } from "react-router-dom";
import { useAtomValue } from "jotai";
import { activeLoadCaseFamily, laminateConfigFamily } from "../store/laminateAtoms";
import { expandedStack, shortStackNotation } from "../lib/angleStack";
import { StackViz } from "./StackViz";
import { QuantityDisplay } from "./QuantityDisplay";
import { useT } from "../i18n";

// A permanent strip above every module page, showing the object the module is
// about: the stack as a thumbnail, its short notation, the ply count and the
// total thickness. Clicking it opens the layup editor.
//
// Why it exists: opening a module used to hide the laminate completely, and
// "see as much as possible at once" is the one idea eLamX is built on. On a
// phone it matters most - there a 16-ply stack is some 5000 px of cards, so
// the 34 px thumbnail is the only place the whole stack is ever visible.
export function ModuleContextBar({ laminateId }: { laminateId: string }) {
  const t = useT();
  const config = useAtomValue(laminateConfigFamily(laminateId));
  const loadCase = useAtomValue(activeLoadCaseFamily(laminateId));

  const notation = shortStackNotation(
    config.layers.map((l) => l.angle),
    config.symmetric,
    config.withMiddleLayer,
  );

  // The EXPANDED stack, which is what the calculation sees - the layer table
  // shows only the stored half of a symmetric laminate.
  const { plies, thickness } = expandedStack(
    config.layers.map((l) => l.thickness),
    config.symmetric,
    config.withMiddleLayer,
  );

  return (
    <Link
      to={`/laminates/${laminateId}`}
      className="module-context-bar"
      title={t("context.openLayup")}
    >
      <StackViz
        layers={config.layers}
        symmetric={config.symmetric}
        withMiddleLayer={config.withMiddleLayer}
        variant="strip"
      />
      <span className="context-name">{config.name}</span>
      <span className="context-notation" title={notation}>
        {notation}
      </span>
      <span className="context-facts">
        <span className="context-load-case">{loadCase.name}</span>
        <span>{t("context.plies", { count: plies })}</span>
        <span>
          t<sub>ges</sub> = <QuantityDisplay category="thickness" value={thickness} />
        </span>
      </span>
    </Link>
  );
}
