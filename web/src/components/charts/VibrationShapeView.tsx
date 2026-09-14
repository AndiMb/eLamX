import { useAtom, useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import {
  loadableVibrationSurfaceFamily,
  selectedVibrationModeFamily,
  vibrationInputFamily,
  vibrationModeListFamily,
} from "../../store/vibrationAtoms";
import { PlateView3D } from "./PlateView3D";
import { PlateLegend, type PlateLegendModel } from "./PlateLegend";
import { formatSignificant } from "../../lib/numberFormat";
import { plyGeometryOf } from "../../lib/plateScene/plyGeometry";
import { layerContributionsFamily } from "../../store/derivedAtoms";
import { plateViewFamily } from "../../store/plateViewAtoms";
import { useLocale, useT } from "../../i18n";

// Mode picker and 3D plate for the vibration module - the buckling module's
// view with two differences, both in what the picture is allowed to claim.
//
// There is no load: a free vibration has none, so the plate is shown with its
// supports and nothing pushing on it. And the mode is labelled by its
// FREQUENCY rather than by an eigenvalue, because that is the number anyone
// reading this module came for.

const Z_SCALE_MIN = 0.02;
const Z_SCALE_MAX = 0.4;

export function VibrationShapeView({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const modes = useAtomValue(vibrationModeListFamily(laminateId));
  const input = useAtomValue(vibrationInputFamily(laminateId));
  const [selected, setSelected] = useAtom(selectedVibrationModeFamily(laminateId));
  const surfaceState = useAtomValue(loadableVibrationSurfaceFamily(laminateId));
  const [zScale, setZScale] = useState(0.12);
  const plies = plyGeometryOf(useAtomValue(layerContributionsFamily(laminateId)));
  const [view, setView] = useAtom(plateViewFamily(laminateId));

  // Normalised to a peak of one, like a buckling mode and for the same reason:
  // a natural mode has a shape and no amplitude.
  const legend = useMemo<PlateLegendModel>(
    () => ({
      title: t("vibration.legend.title"),
      unit: null,
      ticks: [
        { t: 0, text: "-1" },
        { t: 0.5, text: "0" },
        { t: 1, text: "+1" },
      ],
      anchor: 0.5,
      range: t("vibration.legend.range"),
      kind: "diverging",
      gaps: 0,
    }),
    [t],
  );

  if (!modes || modes.length === 0) return null;

  const active = Math.min(selected, modes.length - 1);
  const surface = surfaceState.state === "hasData" ? surfaceState.data : null;

  return (
    <div className="chart viz">
      <p className="chart-title">{t("vibration.shape.title")}</p>

      <div className="chart-controls buckling-mode-picker">
        <label>
          <span className="field-label">{t("vibration.shape.mode")}</span>
          <select value={active} onChange={(e) => setSelected(Number(e.target.value))}>
            {modes.map((mode, i) => (
              <option key={i} value={i}>
                {t("vibration.shape.modeOption", {
                  nr: i + 1,
                  value: formatSignificant(mode.frequency, 5, locale),
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
        <div className="plate3d-with-legend">
          <PlateView3D
            surface={surface}
            length={input.length}
            width={input.width}
            thickness={plies.thickness}
            plyBoundaries={plies.boundaries}
            plyAngles={plies.angles}
            deflectionFraction={zScale}
            bcX={input.bc_x}
            bcY={input.bc_y}
            stiffeners={input.stiffeners}
            layers={view.visible}
            onToggleLayer={(layer) =>
              setView({ ...view, visible: { ...view.visible, [layer]: !view.visible[layer] } })
            }
            legend={legend}
            exportName={t("vibration.legend.title")}
            ariaLabel={t("vibration.plate3d.aria")}
          />
          <PlateLegend model={legend} />
        </div>
      ) : (
        <p className="hint">{t("results.computing")}</p>
      )}

      <p className="hint">{t("buckling.plate3d.hint")}</p>
      <p className="hint">{t("vibration.shape.hint")}</p>
    </div>
  );
}
