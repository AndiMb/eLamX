import { useState } from "react";
import { useAtomValue } from "jotai";
import { materialsAtom } from "../store/materialsAtoms";
import { failureBodiesKey, loadableFailureBodiesFamily } from "../store/failureBodyAtoms";
import { CRITERIA, type CriterionId } from "../lib/types";
import { DEFAULT_CRITERION_ID } from "../lib/constants";
import { FailureBody3D, type FailureBodySurface } from "./charts/FailureBody3D";
import { ChartLegend } from "./charts/ChartLegend";
import { BackLink } from "./BackLink";
import { useChartColors } from "../lib/chartColors";
import { useT } from "../i18n";

// The failure body of a MATERIAL, independent of any laminate - the Java
// original's "Versagenskörper 3D" on a material, and the first module in this
// app that is about a material rather than a stack.
//
// The same surface the ply detail draws, without a stress state in it: there
// is no ply here and therefore no load. What it is for is COMPARING criteria,
// so it draws as many at once as are ticked: the first as a solid body and the
// rest as wireframes over it. Switching between Puck and Tsai-Wu one at a time
// showed how each judges the material; seeing both at once shows where they
// disagree, which is the question anyone opens this view with.

/** How many can be shown at once. Each is an independent surface of 1800
 *  criterion evaluations, and past a handful the picture stops being readable
 *  before the computation stops being cheap. */
const MAX_SHOWN = 5;

export function FailureBodyModuleContent({ materialId }: { materialId: string }) {
  const t = useT();
  const materials = useAtomValue(materialsAtom);
  const [selected, setSelected] = useState<CriterionId[]>([DEFAULT_CRITERION_ID]);

  const material = materials.find((m) => m.id === materialId);
  if (!material) return <p className="hint">{t("material.unknown")}</p>;

  const toggle = (id: CriterionId) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((c) => c !== id)
        : current.length >= MAX_SHOWN
          ? current
          : [...current, id],
    );

  return (
    <>
      <BackLink to={`/materials/${materialId}`} label={t("nav.material")} />
      <p className="hint">{t("failureBody.intro")}</p>

      <section className="panel failure-body">
        <h2>{t("failureBody.title", { material: material.name })}</h2>

        <div className="polar-series-picker" role="group" aria-label={t("failureBody.criteria")}>
          {CRITERIA.map((criterion) => (
            <label key={criterion.id}>
              <input
                type="checkbox"
                checked={selected.includes(criterion.id)}
                disabled={!selected.includes(criterion.id) && selected.length >= MAX_SHOWN}
                onChange={() => toggle(criterion.id)}
              />
              {t(criterion.labelKey)}
            </label>
          ))}
        </div>

        {selected.length === 0 ? (
          <p className="hint">{t("failureBody.none")}</p>
        ) : (
          <FailureBodies materialId={materialId} selected={selected} />
        )}

        <p className="hint">{t("failureBody.hint")}</p>
        {selected.length > 1 && <p className="hint">{t("failureBody.overlay.hint")}</p>}
      </section>
    </>
  );
}

/** One atom for the whole selection - see `failureBodiesFamily` on why it
 *  cannot be one hook per selected criterion. */
function FailureBodies({
  materialId,
  selected,
}: {
  materialId: string;
  selected: CriterionId[];
}) {
  const t = useT();
  // Resolved colours, not CSS variables: these are painted into a canvas.
  const colors = useChartColors();
  const state = useAtomValue(loadableFailureBodiesFamily(failureBodiesKey(materialId, selected)));

  if (state.state === "hasError") {
    return <p className="error">{t("layerDetail.error", { message: String(state.error) })}</p>;
  }
  if (state.state !== "hasData") {
    return <p className="hint">{t("results.computing")}</p>;
  }

  const bodies: FailureBodySurface[] = state.data.map((envelope, index) => ({
    key: selected[index],
    points: envelope.points,
    color: index === 0 ? undefined : colors.series[(index - 1) % colors.series.length],
  }));
  if (bodies.length === 0) return null;

  return (
    <>
      <ChartLegend
        items={bodies.map((body, index) => ({
          key: body.key,
          label: t(CRITERIA.find((c) => c.id === body.key)!.labelKey),
          color: body.color ?? colors.surface,
          shape: index === 0 ? "swatch" : "line",
        }))}
      />
      <FailureBody3D bodies={bodies} markers={[]} />
    </>
  );
}
