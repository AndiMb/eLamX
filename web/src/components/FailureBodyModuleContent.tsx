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
import { MobileCollapse } from "./MobileCollapse";
import { useChartColors } from "../lib/chartColors";
import { parseVtkSurface, type VtkSurface } from "../lib/vtkSurface";
import { SafeNumberInput } from "./SafeNumberInput";
import { Panel } from "./Panel";
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

      <div className="dash">
      <Panel className="failure-body" title={t("failureBody.title", { material: material.name })}>
        {/* The criteria as a list beside the body rather than twenty-four
            checkboxes flowing across three lines above it: a list is read
            top to bottom, and it stands where there was only white beside a
            body capped at 780 px. On a phone it folds away, and the summary
            says what is chosen. */}
        <div className="failure-body-layout">
          <MobileCollapse
            title={`${t("failureBody.criteria")}: ${selected
              .map((id) => {
                const criterion = CRITERIA.find((c) => c.id === id);
                return criterion ? t(criterion.labelKey) : id;
              })
              .join(", ")}`}
          >
            <div className="criteria-list" role="group" aria-label={t("failureBody.criteria")}>
              <p className="criteria-list-title">
                {t("failureBody.criteria")} <span>{selected.length} / {MAX_SHOWN}</span>
              </p>
              {CRITERIA.map((criterion) => {
                const on = selected.includes(criterion.id);
                return (
                  <button
                    key={criterion.id}
                    type="button"
                    aria-pressed={on}
                    className={on ? "active" : undefined}
                    disabled={!on && selected.length >= MAX_SHOWN}
                    onClick={() => toggle(criterion.id)}
                  >
                    {t(criterion.labelKey)}
                  </button>
                );
              })}
            </div>
          </MobileCollapse>

          <div className="failure-body-view">
            {selected.length === 0 ? (
              <p className="hint">{t("failureBody.none")}</p>
            ) : (
              <FailureBodies materialId={materialId} selected={selected} imported={imported?.surface} />
            )}
            <p className="hint">{t("failureBody.hint")}</p>
            {selected.length > 1 && <p className="hint">{t("failureBody.overlay.hint")}</p>}
          </div>
        </div>
      </Panel>

      <Panel title={t("failureBody.import")}>
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

      </Panel>
      </div>
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
          // The id falls back to itself rather than being asserted into a
          // label: a criterion the core can return but this table does not
          // list used to end the lookup in `undefined` and take the whole
          // module down with it. The core's own tests keep the two in step
          // (elamx-core/core/tests/frontend_tables.rs); this is what the
          // legend does on the day they are not.
          label:
            body.key === "imported"
              ? t("failureBody.import.legend")
              : (() => {
                  const criterion = CRITERIA.find((c) => c.id === body.key);
                  return criterion ? t(criterion.labelKey) : body.key;
                })(),
          color: body.color ?? colors.surface,
          shape: index === 0 ? "swatch" : "line",
        }))}
      />
      {/* The scene as a file, the way the original's 3D views export it: one
          four-cornered cell per face, points listed per corner. The importer
          beside it reads exactly this, which is the only reason it can be
          checked against a file rather than against a description of one. */}
      <FailureBody3D
        bodies={bodies}
        markers={[]}
        exports={[
          {
            key: "vtk",
            label: t("failureBody.export.vtk"),
            run: () =>
              downloadVtk(quadsToVtk(bodies.flatMap((body) => body.quads ?? gridToQuads(body.points ?? []))), exportName),
          },
        ]}
      />
    </>
  );
}
