import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import {
  bucklingInputFamily,
  bucklingModeListFamily,
  loadableBucklingSurfaceFamily,
  selectedBucklingModeFamily,
} from "../../store/bucklingAtoms";
import { BucklingPlate3D } from "./BucklingPlate3D";
import { useT } from "../../i18n";

// Mode picker + the 3D plate. Kept separate from BucklingPlate3D so that
// component stays a pure renderer of one surface - it re-renders on every
// drag frame, and it should not also be subscribing to atoms while doing so.

/** Peak deflection as a fraction of the shorter plate edge. */
const Z_SCALE_MIN = 0.02;
const Z_SCALE_MAX = 0.4;

export function BucklingShapeView({ laminateId }: { laminateId: string }) {
  const t = useT();
  const modes = useAtomValue(bucklingModeListFamily(laminateId));
  const input = useAtomValue(bucklingInputFamily(laminateId));
  const [selected, setSelected] = useAtom(selectedBucklingModeFamily(laminateId));
  const surfaceState = useAtomValue(loadableBucklingSurfaceFamily(laminateId));
  const [zScale, setZScale] = useState(0.12);

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
                  value: mode.eigenvalue.toPrecision(5),
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
        <BucklingPlate3D
          surface={surface}
          length={input.length}
          width={input.width}
          zScale={zScale}
        />
      ) : (
        <p className="hint">{t("results.computing")}</p>
      )}

      <p className="hint">{t("buckling.plate3d.hint")}</p>
      <p className="hint">{t("buckling.shape.hint")}</p>
    </div>
  );
}
