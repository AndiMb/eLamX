// The app's side of `<webExtension>`, the element in which a project file
// keeps what only this app uses (see elamx-core's `project::web_extension`).
//
// Its own module, apart from projectFile.ts, because the store needs these
// types and the empty value without pulling in the file reader - and with it
// the wasm worker - just to start.

import type { ImportNotice as CoreImportNotice } from "./generated/ImportNotice";

/** Something about an opened file worth telling the user: the core's notices
 *  plus the ones only this side can find, because only this side knows what
 *  the ids in the file were mapped to. */
export type ImportNotice =
  | CoreImportNotice
  | { kind: "comparison_variant_dropped"; laminate: string; loadCase: string }
  | { kind: "study_load_case_dropped"; study: string; loadCase: string };
