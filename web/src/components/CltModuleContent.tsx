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
  return (
    <>
      <BackLink to={`/laminates/${laminateId}`} label={t("nav.laminate")} />
      <p className="hint">
        {tx("clt.criterionHint", {
          link: <Link to={`/laminates/${laminateId}`}>{t("clt.criterionHint.link")}</Link>,
        })}
      </p>
      <LoadCaseBar laminateId={laminateId} />
      <EquationPanel laminateId={laminateId} />
      <ResultsSection laminateId={laminateId} />
    </>
  );
}
