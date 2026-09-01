import { useAtom, useAtomValue } from "jotai";
import { LAYER_POSITIONS, PLATE_FIELDS, plateFieldDefinition } from "../../lib/plateFields";
import { plateViewFamily } from "../../store/plateViewAtoms";
import { layerContributionsFamily } from "../../store/derivedAtoms";
import { SafeNumberInput } from "../SafeNumberInput";
import type { LayerPositionId, PlateFieldId } from "../../lib/types";
import { useLocale, useT } from "../../i18n";

// Which quantity, in which ply, at which face of it - and, when the automatic
// scale is not what the reader wants to compare against, the limits by hand
// (FR-05).
//
// The ply and position controls stay VISIBLE but disabled while the deflection
// is shown, rather than disappearing. A row of controls that changes length as
// you use it makes the whole panel jump, and the reason they do nothing here -
// the deflection is the same through the thickness - is worth saying once
// rather than leaving as an absence.

export interface PlateFieldControlsProps {
  laminateId: string;
  /** The limits the automatic scale currently uses - what the manual ones
   *  start from, so switching over does not jump the picture. */
  currentBounds: [number, number] | null;
}

export function PlateFieldControls({ laminateId, currentBounds }: PlateFieldControlsProps) {
  const t = useT();
  const locale = useLocale();
  const [view, setView] = useAtom(plateViewFamily(laminateId));
  const plies = useAtomValue(layerContributionsFamily(laminateId)) ?? [];
  const definition = plateFieldDefinition(view.field);
  const manual = view.bounds !== "auto";

  const layer = Math.min(Math.max(0, view.layer), Math.max(0, plies.length - 1));

  return (
    <div className="chart-controls plate-field-controls">
      <label>
        <span className="field-label">{t("plateView.field")}</span>
        <select
          value={view.field}
          onChange={(e) => setView({ ...view, field: e.target.value as PlateFieldId })}
        >
          {PLATE_FIELDS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {t(entry.labelKey)}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="field-label">{t("plateView.layer")}</span>
        <select
          value={layer}
          disabled={!definition.perPly || plies.length === 0}
          onChange={(e) => setView({ ...view, layer: Number(e.target.value) })}
        >
          {plies.map((ply, index) => (
            <option key={ply.layer_number} value={index}>
              {t("plateView.layerOption", {
                nr: ply.layer_number,
                angle: ply.angle_deg.toLocaleString(locale),
              })}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="field-label">{t("plateView.position")}</span>
        <select
          value={view.position}
          disabled={!definition.perPly}
          onChange={(e) => setView({ ...view, position: e.target.value as LayerPositionId })}
        >
          {LAYER_POSITIONS.map((position) => (
            <option key={position} value={position}>
              {t(`plateView.position.${position}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="plate-field-bounds-toggle">
        <input
          type="checkbox"
          checked={manual}
          onChange={(e) =>
            setView({
              ...view,
              bounds: e.target.checked ? (currentBounds ?? [0, 1]) : "auto",
            })
          }
        />
        <span>{t("plateView.bounds.manual")}</span>
      </label>

      {manual && view.bounds !== "auto" && (
        <>
          <label>
            <span className="field-label">{t("plateView.bounds.min")}</span>
            <SafeNumberInput
              value={view.bounds[0]}
              onChange={(v) =>
                setView({ ...view, bounds: [v, (view.bounds as [number, number])[1]] })
              }
            />
          </label>
          <label>
            <span className="field-label">{t("plateView.bounds.max")}</span>
            <SafeNumberInput
              value={view.bounds[1]}
              onChange={(v) =>
                setView({ ...view, bounds: [(view.bounds as [number, number])[0], v] })
              }
            />
          </label>
        </>
      )}

      {!definition.perPly && <p className="hint">{t("plateView.perPlyHint")}</p>}
    </div>
  );
}
