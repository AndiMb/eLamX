import { useAtom, useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import {
  bucklingInputFamily,
  bucklingModeListFamily,
  loadableBucklingSurfaceFamily,
  selectedBucklingModeFamily,
} from "../../store/bucklingAtoms";
import { PlateView3D, type PlateViewLoad } from "./PlateView3D";
import { formatSignificant } from "../../lib/numberFormat";
import { plyGeometryOf } from "../../lib/plateScene/plyGeometry";
import { layerContributionsFamily } from "../../store/derivedAtoms";
import { plateViewFamily } from "../../store/plateViewAtoms";
import { useLocale, useT } from "../../i18n";

// Mode picker + the 3D plate. Kept separate from BucklingPlate3D so that
// component stays a pure renderer of one surface - it re-renders on every
// drag frame, and it should not also be subscribing to atoms while doing so.

/** Peak deflection as a fraction of the shorter plate edge. */
const Z_SCALE_MIN = 0.02;
const Z_SCALE_MAX = 0.4;

export function BucklingShapeView({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const modes = useAtomValue(bucklingModeListFamily(laminateId));
  const input = useAtomValue(bucklingInputFamily(laminateId));
  const [selected, setSelected] = useAtom(selectedBucklingModeFamily(laminateId));
  const surfaceState = useAtomValue(loadableBucklingSurfaceFamily(laminateId));
  const [zScale, setZScale] = useState(0.12);
  const plies = plyGeometryOf(useAtomValue(layerContributionsFamily(laminateId)));
  // The same per-laminate view state the deformation module uses: a reader who
  // switched the supports off in one plate module means it for the plate, not
  // for one of its two analyses.
  const [view, setView] = useAtom(plateViewFamily(laminateId));
  // Held stable so the arrows are not rebuilt every time the mode picker or
  // the exaggeration slider moves; the flows themselves have not changed.
  const load = useMemo<PlateViewLoad>(
    () => ({ kind: "inPlane", nx: input.n_x, ny: input.n_y, nxy: input.n_xy }),
    [input.n_x, input.n_y, input.n_xy],
  );

  if (!modes || modes.length === 0) return null;

  // The list shortens when the term count drops, so a previously picked index
  // can fall off the end - see selectedBucklingModeFamily.
  const active = Math.min(selected, modes.length - 1);
  const surface = surfaceState.state === "hasData" ? surfaceState.data : null;

  return (
    <div className="chart viz">
      <p className="chart-title">{t("buckling.shape.title")}</p>

      <div className="chart-controls buckling-mode-picker">
        <label>
          <span className="field-label">{t("buckling.shape.mode")}</span>
          <select value={active} onChange={(e) => setSelected(Number(e.target.value))}>
            {modes.map((mode, i) => (
              <option key={mode.index} value={i}>
                {t("buckling.shape.modeOption", {
                  nr: i + 1,
                  value: formatSignificant(mode.eigenvalue, 5, locale),
                })}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">{t("buckling.shape.exaggeration")}</span>
          <input
            type="range"
            min={Z_SCALE_MIN}
            max={Z_SCALE_MAX}
            step={0.01}
            value={zScale}
            onChange={(e) => setZScale(Number(e.target.value))}
          />
        </label>
      </div>

      {surface ? (
        <PlateView3D
          surface={surface}
          length={input.length}
          width={input.width}
          thickness={plies.thickness}
          plyBoundaries={plies.boundaries}
          deflectionFraction={zScale}
          bcX={input.bc_x}
          bcY={input.bc_y}
          load={load}
          layers={view.visible}
          onToggleLayer={(layer) =>
            setView({ ...view, visible: { ...view.visible, [layer]: !view.visible[layer] } })
          }
          ariaLabel={t("buckling.plate3d.aria")}
        />
      ) : (
        <p className="hint">{t("results.computing")}</p>
      )}

      <p className="hint">{t("buckling.plate3d.hint")}</p>
      <p className="hint">{t("buckling.shape.hint")}</p>
    </div>
  );
}
