import { useAtomValue } from "jotai";
import { abdMatrixFamily, layerContributionsFamily } from "../store/derivedAtoms";
import { laminateConfigFamily } from "../store/laminateAtoms";
import { materialsAtom } from "../store/materialsAtoms";
import { localQMatrix, fmt } from "../lib/cltFormulas";
import { HowWasThisComputed } from "./HowWasThisComputed";

// A worked example for the FIRST layer only (rather than every layer, which
// would be overwhelming) - explains local Q -> global Q-bar -> A11. Kept as
// its own component (not nested inside AbdMatrixPanel) so it can read the
// laminate's layers/materials directly without widening AbdMatrixPanel's own
// render-isolation guarantees (see AbdMatrixPanel.tsx / the Phase 1-2 render
// count verification) - this is exposition content, opened on demand, not a
// live numeric result that needs the same re-render discipline.
export function AbdExplanation({ laminateId }: { laminateId: string }) {
  const abd = useAtomValue(abdMatrixFamily(laminateId));
  const contributions = useAtomValue(layerContributionsFamily(laminateId));
  const config = useAtomValue(laminateConfigFamily(laminateId));
  const materials = useAtomValue(materialsAtom);

  if (!abd || !contributions || contributions.length === 0) return null;

  const firstLayer = contributions[0];
  const firstLayerConfig = config.layers[0];
  const material = materials.find((m) => m.id === firstLayerConfig?.materialId);
  if (!material) return null;

  const localQ = localQMatrix(material);
  const nue21 = (material.nue12 * material.e_nor) / material.e_par;
  const angleRad = (firstLayer.angle_deg * Math.PI) / 180;
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const c2s2 = c * c * s * s;

  const localQFormula =
    "\\nu_{21} = \\nu_{12}\\dfrac{E_\\perp}{E_\\parallel},\\quad " +
    "Q_{11} = \\dfrac{E_\\parallel}{1-\\nu_{12}\\nu_{21}},\\quad " +
    "Q_{12} = \\nu_{21}Q_{11},\\quad " +
    "Q_{22} = \\dfrac{E_\\perp}{1-\\nu_{12}\\nu_{21}},\\quad " +
    "Q_{66} = G";

  const localQSubstituted = `\\begin{aligned}
\\nu_{21} &= ${fmt(material.nue12, 3)} \\cdot \\dfrac{${fmt(material.e_nor, 0)}}{${fmt(material.e_par, 0)}} = ${fmt(nue21, 4)} \\\\
Q_{11} &= \\dfrac{${fmt(material.e_par, 0)}}{1 - ${fmt(material.nue12, 3)} \\cdot ${fmt(nue21, 4)}} = ${fmt(localQ.q11, 1)}\\ \\text{MPa} \\\\
Q_{12} &= ${fmt(nue21, 4)} \\cdot ${fmt(localQ.q11, 1)} = ${fmt(localQ.q12, 1)}\\ \\text{MPa} \\\\
Q_{22} &= \\dfrac{${fmt(material.e_nor, 0)}}{1 - ${fmt(material.nue12, 3)} \\cdot ${fmt(nue21, 4)}} = ${fmt(localQ.q22, 1)}\\ \\text{MPa} \\\\
Q_{66} &= G = ${fmt(localQ.q66, 1)}\\ \\text{MPa}
\\end{aligned}`;

  const qBarFormula =
    "\\bar Q_{11} = c^4 Q_{11} + 2c^2s^2 Q_{12} + s^4 Q_{22} + 4c^2s^2 Q_{66}, \\quad c=\\cos\\theta,\\ s=\\sin\\theta";

  const qBarSubstituted = `\\begin{aligned}
\\theta &= ${fmt(firstLayer.angle_deg, 1)}^\\circ, \\quad c = ${fmt(c, 3)}, \\quad s = ${fmt(s, 3)} \\\\
\\bar Q_{11} &= ${fmt(c ** 4, 3)}\\cdot ${fmt(localQ.q11, 1)} + 2\\cdot ${fmt(c2s2, 3)}\\cdot ${fmt(localQ.q12, 1)} + ${fmt(s ** 4, 3)}\\cdot ${fmt(localQ.q22, 1)} + 4\\cdot ${fmt(c2s2, 3)}\\cdot ${fmt(localQ.q66, 1)} \\\\
&= ${fmt(firstLayer.q_global[0][0], 1)}\\ \\text{MPa} \\quad (\\text{tatsächlicher Wert aus der Berechnung})
\\end{aligned}`;

  const abdFormula = "A_{11} = \\sum_k \\bar Q_{11,k} \\cdot t_k";
  const terms = contributions.map((c) => fmt(c.a_contribution[0][0], 1)).join(" + ");
  const abdSubstituted = `A_{11} = ${terms} = ${fmt(abd[0][0], 1)}\\ \\text{N/mm}`;

  return (
    <>
      <HowWasThisComputed title="lokale Steifigkeit Q (Lage 1)" formula={localQFormula} substituted={localQSubstituted}>
        <p className="hint">
          Aus den Werkstoffkennwerten (E&#8741;, E&perp;, &nu;12, G) von &bdquo;{material.name}&ldquo; - siehe Materialseite.
        </p>
      </HowWasThisComputed>
      <HowWasThisComputed
        title="Drehung ins Laminat-Koordinatensystem (Q&#772;, Lage 1)"
        formula={qBarFormula}
        substituted={qBarSubstituted}
      >
        <p className="hint">Analog für Q&#772;12, Q&#772;16, Q&#772;22, Q&#772;26, Q&#772;66.</p>
      </HowWasThisComputed>
      <HowWasThisComputed title="Aufbau der A-Matrix (A11)" formula={abdFormula} substituted={abdSubstituted}>
        <p className="hint">Jeder Summand ist der A-Beitrag einer Lage (Q&#772;11 der Lage mal ihrer Dicke t).</p>
      </HowWasThisComputed>
    </>
  );
}
