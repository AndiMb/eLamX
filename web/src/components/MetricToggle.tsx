import { useAtom } from "jotai";
import { failureMetricAtom } from "../store/settingsAtoms";
import { FAILURE_METRICS, METRIC_LABEL_KEYS } from "../lib/failureMetric";
import { useT } from "../i18n";

// RF / IRF / MoS (F2.2). One global display setting, so the switch can sit
// wherever reserve factors are shown and every one of those places follows.
export function MetricToggle() {
  const t = useT();
  const [metric, setMetric] = useAtom(failureMetricAtom);
  return (
    <div className="segmented metric-toggle" role="radiogroup" aria-label={t("metric.toggle")}>
      {FAILURE_METRICS.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={metric === m}
          className={metric === m ? "active" : undefined}
          title={t(`metric.${m}.title`)}
          onClick={() => setMetric(m)}
        >
          {t(METRIC_LABEL_KEYS[m])}
        </button>
      ))}
    </div>
  );
}
