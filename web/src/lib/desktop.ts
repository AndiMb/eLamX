// The desktop shell, when there is one.
//
// The app is a web app first: everything here is optional, and `desktop()`
// returns null in a browser tab. What the shell adds is the three things a
// page cannot do - pick a file by path, write back to the file that was
// opened, and be told about a double-clicked document - and the app asks for
// them only after checking they are there.
//
// Deliberately a lookup rather than a build-time flag. One bundle runs in the
// browser, in the Electron window and, later, wherever else it is put; a flag
// would mean two builds that have to be tested twice.

export interface DesktopProject {
  xml: string;
  /** Where it came from, so Save can write back to it. */
  filePath: string;
  /** The file name without its extension, which is the project's name. */
  name: string;
}

export type DesktopCommand = "open" | "save" | "saveAs";

export interface DesktopBridge {
  platform: string;
  openProject(suggestedPath?: string | null): Promise<DesktopProject | null>;
  saveProject(
    xml: string,
    filePath: string | null,
    suggestedName: string,
  ): Promise<{ filePath: string; name: string } | null>;
  saveImage(bytes: Uint8Array, suggestedName: string): Promise<string | null>;
  setLocale(locale: string): void;
  ready(): void;
  onCommand(handler: (command: DesktopCommand) => void): () => void;
  onProjectOpened(handler: (project: DesktopProject) => void): () => void;
}

declare global {
  interface Window {
    elamxDesktop?: DesktopBridge;
  }
}

/** The shell, or null when this is running in a browser. */
export function desktop(): DesktopBridge | null {
  return typeof window !== "undefined" ? (window.elamxDesktop ?? null) : null;
}
