import { useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import {
  ENVELOPE_RESOLUTIONS,
  laminateEnvelopeKey,
  loadableLaminateEnvelopeFamily,
  type EnvelopeResolutionId,
} from "../store/laminateEnvelopeAtoms";
import { layerContributionsFamily } from "../store/derivedAtoms";
import { LAMINATE_FAILURE_KINDS, type LaminateFailureKindId } from "../lib/types";
import { FailureBody3D, type FailureBodySurface } from "./charts/FailureBody3D";
import { ChartLegend } from "./charts/ChartLegend";
import { ResponsiveTable } from "./ResponsiveTable";
import { BackLink } from "./BackLink";
import { Sym } from "./Sym";
import { useChartColors } from "../lib/chartColors";
import { formatSignificant } from "../lib/numberFormat";
import { useLocale, useT } from "../i18n";

// Which load flows this stacking sequence can carry - the original's
// "Laminat-Versagenskörper".
//
// The material failure body next door is about one ply and one criterion. This
// is about the stack: every point on the surface is a combination of n_x, n_y
// and n_xy at which the laminate fails, and the colour says WHICH ply gives
// out there. That last part is what turns it from a picture into an answer -
// a surface that is pinched in shear because one 90 degree ply governs tells
// you what to change.

const AXES: [string, string, string] = ["n_x", "n_y", "n_xy"];

export function LaminateFailureModuleContent({ laminateId }: { laminateId: string }) {
  const t = useT();
  const locale = useLocale();
  const colors = useChartColors();
  const [kind, setKind] = useState<LaminateFailureKindId>("first_ply");
  const [resolution, setResolution] = useState<EnvelopeResolutionId>("coarse");
  const plies = useAtomValue(layerContributionsFamily(laminateId));

  const state = useAtomValue(
    loadableLaminateEnvelopeFamily(laminateEnvelopeKey(laminateId, kind, resolution)),
  );
  const envelope = state.state === "hasData" ? state.data : null;

  // One colour per ply, so the same ply keeps its colour as the reader
  // switches between the two failure definitions.
  const plyColor = useMemo(
    () => (index: number) => colors.series[index % colors.series.length],
    [colors],
  );

  const bodies: FailureBodySurface[] = useMemo(() => {
    if (!envelope) return [];
    const points = envelope.points.map((row) => row.map((p) => p.load));
    // A cell takes the colour of the ply governing at its first corner: the
    // grid is fine enough that the boundary between two plies' regions is a
    // line, not a patchwork.
    const cellColors = envelope.points
      .slice(0, -1)
      .map((row) => row.slice(0, -1).map((p) => (p.layer === null ? null : plyColor(p.layer))));
    return [{ key: "laminate", points, cellColors }];
  }, [envelope, plyColor]);

  const governing = useMemo(() => {
    if (!envelope) return [];
    const seen = new Set<number>();
    for (const row of envelope.points) {
      for (const point of row) if (point.layer !== null) seen.add(point.layer);
    }
    return [...seen].sort((a, b) => a - b);
  }, [envelope]);

  const axisRows = useMemo(() => {
    if (!envelope) return [];
    const [nxMax, nxMin, nyMax, nyMin, nxyMax, nxyMin] = envelope.axis_intersections;
    return [
      { key: "n_x", sub: "x", positive: Math.max(nxMax, nxMin), negative: Math.min(nxMax, nxMin) },
      { key: "n_y", sub: "y", positive: Math.max(nyMax, nyMin), negative: Math.min(nyMax, nyMin) },
      {
        key: "n_xy",
        sub: "xy",
        positive: Math.max(nxyMax, nxyMin),
        negative: Math.min(nxyMax, nxyMin),
      },
    ];
  }, [envelope]);

  return (
    <>
      <BackLink to={`/laminates/${laminateId}`} label={t("nav.laminate")} />
      <p className="hint">{t("laminateFailure.intro")}</p>

      <section className="panel">
        <h2>{t("laminateFailure.title")}</h2>

        <div className="field-grid">
          <label className="wide">
            <span className="field-label">{t("laminateFailure.kind")}</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as LaminateFailureKindId)}
            >
              {LAMINATE_FAILURE_KINDS.map((option) => (
                <option key={option.id} value={option.id}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">{t("laminateFailure.resolution")}</span>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as EnvelopeResolutionId)}
            >
              {(Object.keys(ENVELOPE_RESOLUTIONS) as EnvelopeResolutionId[]).map((id) => (
                <option key={id} value={id}>
                  {t(`laminateFailure.resolution.${id}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint">{t(`laminateFailure.kind.hint.${kind}`)}</p>

        {state.state === "hasError" && (
          <p className="error">{t("laminateFailure.error", { message: String(state.error) })}</p>
        )}
        {state.state === "loading" && <p className="hint">{t("laminateFailure.computing")}</p>}

        {envelope && (
          <>
            <ChartLegend
              items={governing.map((index) => ({
                key: String(index),
                label: t("laminateFailure.ply", {
                  nr: index + 1,
                  angle: formatSignificant(plies?.[index]?.angle_deg ?? 0, 4, locale),
                }),
                color: plyColor(index),
                shape: "swatch",
              }))}
            />
            <FailureBody3D bodies={bodies} markers={[]} axisLabels={AXES} />
            <p className="hint">{t("laminateFailure.hint")}</p>
          </>
        )}
      </section>

      {envelope && (
        <section className="panel">
          <h2>{t("laminateFailure.axes.title")}</h2>
          <ResponsiveTable
            variant="records"
            columns={[
              {
                key: "flow",
                label: t("laminateFailure.axes.flow"),
                render: (row) => <Sym base="n" sub={row.sub} />,
              },
              {
                key: "positive",
                label: t("laminateFailure.axes.positive"),
                numeric: true,
                render: (row) => formatSignificant(row.positive, 5, locale),
              },
              {
                key: "negative",
                label: t("laminateFailure.axes.negative"),
                numeric: true,
                render: (row) => formatSignificant(row.negative, 5, locale),
              },
            ]}
            rows={axisRows}
            rowKey={(row) => row.key}
          />
          <p className="hint">{t("laminateFailure.axes.hint")}</p>
        </section>
      )}
    </>
  );
}
