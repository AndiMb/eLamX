import { Link } from "react-router-dom";
import { ResultsSection } from "./ResultsSection";
import { EquationPanel } from "./EquationPanel";
import { BackLink } from "./BackLink";

// The content behind the "clt" entry in MODULE_REGISTRY. Failure criterion
// and its additional parameters (Tsai-Wu F12*, Puck p_spd, ...) are edited
// per LAYER now (see LaminatePage's layer table) and per MATERIAL (see
// MaterialPage) respectively, not here.
export function CltModuleContent({ laminateId }: { laminateId: string }) {
  return (
    <>
      <BackLink to={`/laminates/${laminateId}`} label="Laminat" />
      <p className="hint">
        Versagenskriterium und Name je Lage werden im{" "}
        <Link to={`/laminates/${laminateId}`}>Lagenaufbau</Link> festgelegt.
      </p>
      <EquationPanel laminateId={laminateId} />
      <ResultsSection laminateId={laminateId} />
    </>
  );
}
