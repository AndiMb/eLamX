// The app's side of `<webExtension>`, the element in which a project file
// keeps what only this app uses (see elamx-core's `project::web_extension`).
//
// Its own module, apart from projectFile.ts, because the store needs these
// types and the empty value without pulling in the file reader - and with it
// the wasm worker - just to start.

import type { ImportNotice as CoreImportNotice } from "./generated/ImportNotice";

/** The parts of `<webExtension>` no feature of this build edits yet.
 *
 *  The layers' extra criteria are not among them: the core moves them onto
 *  the layers when it reads a file (`Layer.extra_criteria`) and writes them
 *  back from there, so they live in the laminate like every other ply
 *  property. */
export interface WebExtensionCarry {
  studies: unknown[];
  snapshots: unknown[];
}

export const EMPTY_WEB_EXTENSION_CARRY: WebExtensionCarry = {
  studies: [],
  snapshots: [],
};

/** Something about an opened file worth telling the user: the core's notices
 *  plus the ones only this side can find, because only this side knows what
 *  the ids in the file were mapped to. */
export type ImportNotice =
  | CoreImportNotice
  | { kind: "comparison_variant_dropped"; laminate: string; loadCase: string };
