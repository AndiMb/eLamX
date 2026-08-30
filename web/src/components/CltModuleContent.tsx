import { Link } from "react-router-dom";
import { ResultsSection } from "./ResultsSection";
import { EquationPanel } from "./EquationPanel";
import { LoadCaseBar } from "./LoadCaseBar";
import { BackLink } from "./BackLink";
import { useT, useTx } from "../i18n";

// The content behind the "clt" entry in MODULE_REGISTRY. Failure criterion
// and its additional parameters (Tsai-Wu F12*, Puck p_spd, ...) are edited
// per LAYER now (see LaminatePage's layer table) and per MATERIAL (see
// MaterialPage) respectively, not here.
export function CltModuleContent({ laminateId }: { laminateId: string }) {
  const t = useT();
  const tx = useTx();
  // A flex column rather than a plain fragment, so that a narrow screen can
  // lift the verdict above the equation without moving it in the DOM - see
  // .module-stack in App.css. On a phone the order that matters is enter a
  // load, read the answer; on a wide screen the equation carries the answer's
  // derivation beside it and belongs first.
  return (
    <div className="module-stack">
      <BackLink to={`/laminates/${laminateId}`} label={t("nav.laminate")} />
      <p className="hint">
        {tx("clt.criterionHint", {
          link: <Link to={`/laminates/${laminateId}`}>{t("clt.criterionHint.link")}</Link>,
        })}
      </p>
      <LoadCaseBar laminateId={laminateId} />
      <EquationPanel laminateId={laminateId} />
      <ResultsSection laminateId={laminateId} />
    </div>
  );
}
