// The app's side of `<webExtension>`, the element in which a project file
// keeps what only this app uses (see elamx-core's `project::web_extension`).
//
// Its own module, apart from projectFile.ts, because the store needs these
// types and the empty value without pulling in the file reader - and with it
// the wasm worker - just to start.

import type { ImportNotice as CoreImportNotice } from "./generated/ImportNotice";
import type { LayerCriteriaEntry } from "./generated/LayerCriteriaEntry";

/** The parts of `<webExtension>` no feature of this build edits yet. */
export interface WebExtensionCarry {
  layerCriteria: LayerCriteriaEntry[];
  studies: unknown[];
  snapshots: unknown[];
  reportTemplates: unknown[];
  stackingRuleSettings: unknown;
}

export const EMPTY_WEB_EXTENSION_CARRY: WebExtensionCarry = {
  layerCriteria: [],
  studies: [],
  snapshots: [],
  reportTemplates: [],
  stackingRuleSettings: null,
};

/** Something about an opened file worth telling the user: the core's notices
 *  plus the ones only this side can find, because only this side knows what
 *  the ids in the file were mapped to. */
export type ImportNotice =
  | CoreImportNotice
  | { kind: "comparison_variant_dropped"; laminate: string; loadCase: string };
