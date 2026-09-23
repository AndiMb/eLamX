// The stacking-rule check (F2.7): its thresholds, which belong to the project
// and travel in the file's <webExtension>, and its verdict per laminate,
// which the core computes.
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { atomWithStorage } from "jotai/utils";
import { loadableWithLastValue } from "../lib/loadable";
import type { RuleResult } from "../lib/generated/RuleResult";
import type { RuleSettings } from "../lib/generated/RuleSettings";
import { elamx } from "../lib/wasm";
import { laminateConfigFamily } from "./laminateAtoms";

/** The core's defaults - `RuleSettings::default()`. */
export const DEFAULT_RULE_SETTINGS: RuleSettings = { min_fraction: 0.1, max_consecutive: 4 };

/** The thresholds the user set, or null for the defaults. Null rather than
 *  the defaults written out, so a project that never touched them writes no
 *  settings into its file. */
export const stackingRuleSettingsAtom = atomWithStorage<RuleSettings | null>(
  "elamx.stackingRuleSettings",
  null,
);

export const effectiveRuleSettingsAtom = atom<RuleSettings>(
  (get) => get(stackingRuleSettingsAtom) ?? DEFAULT_RULE_SETTINGS,
);

/** A laminate's rule results. Depends on the angles and the symmetry flags
 *  only - a new thickness or material does not re-ask the core. */
const rulesInputFamily = atomFamily((laminateId: string) =>
  atom(
    (get) => {
      const config = get(laminateConfigFamily(laminateId));
      return JSON.stringify({
        angles: config.layers.map((l) => l.angle),
        symmetric: config.symmetric,
        with_middle_layer: config.withMiddleLayer,
        settings: get(effectiveRuleSettingsAtom),
      });
    },
  ),
);

export const stackingRulesFamily = atomFamily((laminateId: string) =>
  atom<Promise<RuleResult[]>>(async (get) => {
    const request = get(rulesInputFamily(laminateId));
    return JSON.parse(await elamx.check_stacking_rules(request, `rules:${laminateId}`)) as RuleResult[];
  }),
);

export const loadableStackingRulesFamily = atomFamily((laminateId: string) =>
  loadableWithLastValue(stackingRulesFamily(laminateId)),
);
