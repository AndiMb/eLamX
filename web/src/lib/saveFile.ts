// Writing a file the app has produced - a picture, a table, later a report.
//
// In the desktop shell that is a system dialog and a real path; in a browser
// it is a download, because a page cannot be told where to put a file. One
// function for every kind, so each export decides WHAT to write and none of
// them has to know where it is running.
import { desktop } from "./desktop";

/** The kinds of file the shell will offer to save. A fixed list rather than
 *  filters handed over from the page: the main process decides what its save
 *  dialog offers, the renderer only picks from it. */
export type SaveFileKind = "png" | "svg" | "csv" | "pdf";

const KINDS: readonly SaveFileKind[] = ["png", "svg", "csv", "pdf"];

/** The kind a file name implies, from its extension, or null for none of them. */
export function kindOf(filename: string): SaveFileKind | null {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return (KINDS as readonly string[]).includes(extension) ? (extension as SaveFileKind) : null;
}

/**
 * Writes `blob` where the reader wants it.
 *
 * `kinds` are the filters the desktop dialog offers, the first one selected;
 * without them the file name's extension decides. Resolves to the path it was
 * written to in the shell, and to null for a dismissed dialog or a browser
 * download - a page never learns where a download went.
 */
export async function saveFile(
  blob: Blob,
  suggestedName: string,
  kinds?: SaveFileKind[],
): Promise<string | null> {
  const shell = desktop();
  if (shell) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const offered = kinds ?? [kindOf(suggestedName) ?? "png"];
    // A shell from before `saveFile` knew only pictures.
    return shell.saveFile
      ? shell.saveFile(bytes, suggestedName, offered)
      : shell.saveImage(bytes, suggestedName);
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  link.click();
  // Revoked on the next task rather than immediately: Safari has not started
  // reading the blob by the time click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return null;
}
