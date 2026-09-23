// The report dialog's state: the templates saved in the project, and the
// settings the dialog opens with.

import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { defaultReportTemplate, SECTION_KINDS, type ReportTemplate, type SectionKind } from "../lib/report/model";
import type { ReportTemplate as FileReportTemplate } from "../lib/generated/ReportTemplate";

const storage = createJSONStorage<ReportTemplate[]>(() => localStorage);

/** Report templates saved under a name - part of the project, written to the
 *  file's `<webExtension>` and undone like any other edit. */
export const reportTemplatesAtom = atomWithStorage<ReportTemplate[]>("elamx.reportTemplates", [], storage, {
  getOnInit: true,
});

/** What the dialog shows when it opens: the last report's settings. A setting
 *  of this browser, not of the project. */
export const reportDraftAtom = atomWithStorage<ReportTemplate>(
  "elamx.reportDraft",
  defaultReportTemplate(),
  createJSONStorage<ReportTemplate>(() => localStorage),
  { getOnInit: true },
);

/** Whether the report dialog is open. */
export const reportDialogOpenAtom = atom(false);

/** A template as the file keeps it. */
export function toFileTemplate(template: ReportTemplate): FileReportTemplate {
  return {
    name: template.name,
    sections: template.sections,
    laminates: template.laminates,
    load_cases: template.loadCases,
    detail: template.detail,
    paper: template.paper,
    author: template.author,
    signature: template.signature,
  };
}

/** A template from the file. A section kind or a choice this build does not
 *  know is left out rather than guessed at. */
export function fromFileTemplate(template: FileReportTemplate): ReportTemplate {
  const defaults = defaultReportTemplate();
  return {
    name: template.name,
    sections: template.sections.filter((s): s is SectionKind => (SECTION_KINDS as readonly string[]).includes(s)),
    laminates: template.laminates,
    loadCases: template.load_cases === "all" ? "all" : "active",
    detail: template.detail === "derivation" ? "derivation" : "results",
    paper: template.paper === "letter" ? "letter" : defaults.paper,
    author: template.author,
    signature: template.signature,
  };
}
