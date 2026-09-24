import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { CircleCheck, CircleAlert, Ruler } from "lucide-react";
import {
  DEFAULT_RULE_SETTINGS,
  effectiveRuleSettingsAtom,
  loadableRulesOfFamily,
  loadableStackingRulesFamily,
  stackingRuleSettingsAtom,
} from "../store/stackingRuleAtoms";
import type { RuleResult } from "../lib/generated/RuleResult";
import type { StackingRule } from "../lib/generated/StackingRule";
import type { OrientationFamily } from "../lib/generated/OrientationFamily";
import { formatFixed } from "../lib/numberFormat";
import { SafeNumberInput } from "./SafeNumberInput";
import { historyStep } from "../lib/history";
import { useLocale, useT, type MessageKey } from "../i18n";

// The design rules of the stack (F2.7) as badges: advisory, never blocking.
// Each badge carries an icon as well as its colour (N7) and opens an
// explanation of all five rules, where the thresholds can be changed.

const RULE_KEYS: Record<StackingRule, { label: MessageKey; why: MessageKey }> = {
  symmetric: { label: "rules.symmetric", why: "rules.symmetric.why" },
  balanced: { label: "rules.balanced", why: "rules.balanced.why" },
  min_fraction: { label: "rules.minFraction", why: "rules.minFraction.why" },
  max_consecutive: { label: "rules.maxConsecutive", why: "rules.maxConsecutive.why" },
  outer_plies45: { label: "rules.outer45", why: "rules.outer45.why" },
};

const FAMILY_LABELS: Record<OrientationFamily, string> = {
  zero: "0°",
  plus_minus45: "±45°",
  ninety: "90°",
};

function useRuleText() {
  const t = useT();
  const locale = useLocale();
  const settings = useAtomValue(effectiveRuleSettingsAtom);
  const angle = (a: number) => `${formatFixed(a, Number.isInteger(a) ? 0 : 1, locale)}°`;
  const percent = (share: number) => `${formatFixed(share * 100, 0, locale)} %`;

  const label = (rule: StackingRule) =>
    t(RULE_KEYS[rule].label, {
      percent: percent(settings.min_fraction),
      count: settings.max_consecutive,
    });

  const detail = (r: RuleResult): string => {
    const d = r.detail;
    switch (d.kind) {
      case "symmetry":
        return d.mismatch
          ? t("rules.detail.symmetryMismatch", { a: d.mismatch[0], b: d.mismatch[1] })
          : t("rules.detail.symmetric");
      case "balance":
        return d.unbalanced.length === 0
          ? t("rules.detail.balanced")
          : d.unbalanced
              .map((u) => t("rules.detail.unbalanced", { angle: angle(u.angle), plus: u.plus, minus: u.minus }))
              .join("; ");
      case "fractions":
        return d.shares.map((s) => `${FAMILY_LABELS[s.family]}: ${percent(s.share)}`).join(" · ");
      case "longest_run":
        return t("rules.detail.run", { length: d.length, angle: angle(d.angle), start: d.start });
      case "surfaces":
        return t("rules.detail.surfaces", { top: angle(d.top), bottom: angle(d.bottom) });
    }
  };
  return { label, detail };
}

/** The badges, for the laminate editor. */
export function StackingRuleBadges({ laminateId }: { laminateId: string }) {
  const t = useT();
  const loadable = useAtomValue(loadableStackingRulesFamily(laminateId));
  const { label, detail } = useRuleText();
  const [open, setOpen] = useState<StackingRule | null>(null);
  if (loadable.state !== "hasData" || loadable.data.length === 0) return null;
  const results = loadable.data;

  return (
    <>
      <ul className="rule-badges" aria-label={t("rules.title")}>
        {results.map((r) => (
          <li key={r.rule}>
            <button
              type="button"
              className={r.passed ? "rule-badge passed" : "rule-badge unmet"}
              title={`${label(r.rule)}: ${detail(r)}`}
              onClick={() => setOpen(r.rule)}
            >
              {r.passed ? (
                <CircleCheck size={13} aria-label={t("rules.passed")} />
              ) : (
                <CircleAlert size={13} aria-label={t("rules.notPassed")} />
              )}
              {label(r.rule)}
            </button>
          </li>
        ))}
      </ul>
      {open && <StackingRulesDialog results={results} focus={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** The rules of any stack - a candidate of the optimisation, say - as icons
 *  with a count, the unmet ones named in the tooltip and for screen readers. */
export function CompactRuleBadges({ angles, symmetric }: { angles: number[]; symmetric: boolean }) {
  const t = useT();
  const settings = useAtomValue(effectiveRuleSettingsAtom);
  const { label, detail } = useRuleText();
  const request = JSON.stringify({ angles, symmetric, with_middle_layer: false, settings });
  const loadable = useAtomValue(loadableRulesOfFamily(request));
  if (loadable.state !== "hasData") return null;
  const results = loadable.data;
  const unmet = results.filter((r) => !r.passed);
  const text = unmet.length === 0 ? t("rules.allPassed") : unmet.map((r) => `${label(r.rule)}: ${detail(r)}`).join("; ");
  return (
    <span className={unmet.length === 0 ? "rule-compact passed" : "rule-compact unmet"} title={text} aria-label={text}>
      {unmet.length === 0 ? <CircleCheck size={13} aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />}
      {results.length - unmet.length}/{results.length}
    </span>
  );
}

/** The collapsed form for the module context bar, which is one link to the
 *  editor: a count, not buttons - the badges are one click away there. */
export function StackingRuleSummary({ laminateId }: { laminateId: string }) {
  const t = useT();
  const loadable = useAtomValue(loadableStackingRulesFamily(laminateId));
  if (loadable.state !== "hasData" || loadable.data.length === 0) return null;
  const failing = loadable.data.filter((r) => !r.passed).length;
  return failing === 0 ? (
    <span className="rule-summary passed" title={t("rules.allPassed")}>
      <CircleCheck size={12} aria-hidden="true" />
      {t("rules.summary.passed")}
    </span>
  ) : (
    <span className="rule-summary unmet" title={t("rules.summary.title")}>
      <CircleAlert size={12} aria-hidden="true" />
      {t(failing === 1 ? "rules.summary.one" : "rules.summary.other", { count: failing })}
    </span>
  );
}

function StackingRulesDialog({
  results,
  focus,
  onClose,
}: {
  results: RuleResult[];
  focus: StackingRule;
  onClose: () => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [stored, setStored] = useAtom(stackingRuleSettingsAtom);
  const settings = stored ?? DEFAULT_RULE_SETTINGS;
  const { label, detail } = useRuleText();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    element?.querySelector<HTMLElement>(`[data-rule="${focus}"]`)?.scrollIntoView({ block: "nearest" });
    return () => element?.close();
  }, [focus]);

  // Typed thresholds coalesce into one undo step like any other field (see
  // lib/history); the label comes from the changed path.
  const update = (patch: Partial<typeof settings>) => setStored({ ...settings, ...patch });

  return (
    <dialog
      ref={dialog}
      className="app-dialog rules-dialog"
      aria-labelledby="rules-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
        }}
      >
        <h2 id="rules-dialog-title">
          <Ruler size={16} strokeWidth={1.75} />
          {t("rules.title")}
        </h2>
        <p className="hint">{t("rules.intro")}</p>
        <ol className="rules-list">
          {results.map((r) => (
            <li
              key={r.rule}
              data-rule={r.rule}
              className={[r.passed ? "passed" : "unmet", r.rule === focus ? "focused" : null].filter(Boolean).join(" ")}
            >
              <div className="rules-list-head">
                {r.passed ? (
                  <CircleCheck size={14} aria-label={t("rules.passed")} />
                ) : (
                  <CircleAlert size={14} aria-label={t("rules.notPassed")} />
                )}
                <strong>{label(r.rule)}</strong>
              </div>
              <p className="rules-detail">{detail(r)}</p>
              <p className="hint">{t(RULE_KEYS[r.rule].why)}</p>
              {r.rule === "min_fraction" && (
                <label className="rules-threshold">
                  {t("rules.threshold.minFraction")}
                  <SafeNumberInput
                    value={Math.round(settings.min_fraction * 1000) / 10}
                    onChange={(v) => update({ min_fraction: Math.min(100, Math.max(0, v)) / 100 })}
                    aria-label={t("rules.threshold.minFraction")}
                  />
                  %
                </label>
              )}
              {r.rule === "max_consecutive" && (
                <label className="rules-threshold">
                  {t("rules.threshold.maxConsecutive")}
                  <SafeNumberInput
                    value={settings.max_consecutive}
                    onChange={(v) => update({ max_consecutive: Math.max(1, Math.round(v)) })}
                    aria-label={t("rules.threshold.maxConsecutive")}
                  />
                </label>
              )}
            </li>
          ))}
        </ol>
        <div className="dialog-actions">
          {stored && (
            <button type="button" onClick={() => historyStep(t("history.label.ruleSettings"), () => setStored(null))}>
              {t("rules.resetThresholds")}
            </button>
          )}
          <button type="submit" className="primary">
            {t("rules.close")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
