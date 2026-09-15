import { useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { materialsAtom } from "../store/materialsAtoms";
import { failureBodiesKey, loadableFailureBodiesFamily } from "../store/failureBodyAtoms";
import { CRITERIA, type CriterionId } from "../lib/types";
import { DEFAULT_CRITERION_ID } from "../lib/constants";
import { FailureBody3D, type FailureBodySurface } from "./charts/FailureBody3D";
import { downloadVtk, gridToQuads, quadsToVtk } from "../lib/vtkExport";
import { ChartLegend } from "./charts/ChartLegend";
import { BackLink } from "./BackLink";
import { useChartColors } from "../lib/chartColors";
import { parseVtkSurface, type VtkSurface } from "../lib/vtkSurface";
import { SafeNumberInput } from "./SafeNumberInput";
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
  // A surface from somewhere else - an FE study, a test campaign - drawn in
  // the same space as the criteria so the two can be compared. The original
  // offers this too; see lib/vtkSurface on what its file format actually is.
  const [imported, setImported] = useState<{ name: string; surface: VtkSurface } | null>(null);
  const [importScale, setImportScale] = useState(1);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const openFile = async (file: File) => {
    try {
      setImported({ name: file.name, surface: parseVtkSurface(await file.text(), importScale) });
      setImportError(null);
    } catch (error) {
      setImported(null);
      setImportError(error instanceof Error ? error.message : String(error));
    }
  };

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
          <FailureBodies materialId={materialId} selected={selected} imported={imported?.surface} />
        )}

        <h3>{t("failureBody.import")}</h3>
        <p className="hint">{t("failureBody.import.hint")}</p>
        <div className="field-grid">
          <label>
            <span className="field-label">{t("failureBody.import.scale")}</span>
            <SafeNumberInput value={importScale} onChange={setImportScale} />
          </label>
        </div>
        <div className="flags">
          <button type="button" onClick={() => fileInput.current?.click()}>
            {t("failureBody.import.open")}
          </button>
          {imported && (
            <button type="button" onClick={() => setImported(null)}>
              {t("failureBody.import.remove")}
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".vtk,text/plain"
          className="visually-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openFile(file);
            // Cleared so picking the same file again still fires a change.
            e.target.value = "";
          }}
        />
        {importError && <p className="error">{t("failureBody.import.error", { message: importError })}</p>}
        {imported && (
          <p className="hint">
            {t("failureBody.import.loaded", {
              name: imported.name,
              faces: imported.surface.quads.length,
            })}
          </p>
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
  imported,
}: {
  materialId: string;
  selected: CriterionId[];
  imported?: VtkSurface;
}) {
  const exportName = `versagenskoerper-${materialId}`;
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
  if (imported) {
    // Always an overlay, never the solid body: it is the thing being compared
    // AGAINST the criteria, and it has no grid for the shading to follow.
    bodies.push({
      key: "imported",
      quads: imported.quads,
      color: colors.series[bodies.length % colors.series.length],
    });
  }
  if (bodies.length === 0) return null;

  return (
    <>
      <ChartLegend
        items={bodies.map((body, index) => ({
          key: body.key,
          label:
            body.key === "imported"
              ? t("failureBody.import.legend")
              : t(CRITERIA.find((c) => c.id === body.key)!.labelKey),
          color: body.color ?? colors.surface,
          shape: index === 0 ? "swatch" : "line",
        }))}
      />
      <FailureBody3D bodies={bodies} markers={[]} />
      <div className="flags">
        {/* The scene as a file, the way the original's 3D views export it: one
            four-cornered cell per face, points listed per corner. The importer
            next door reads exactly this, which is the only reason it can now be
            checked against a file rather than against a description of one. */}
        <button
          type="button"
          onClick={() =>
            downloadVtk(
              quadsToVtk(bodies.flatMap((body) => body.quads ?? gridToQuads(body.points ?? []))),
              exportName,
            )
          }
        >
          {t("failureBody.export")}
        </button>
      </div>
    </>
  );
}
