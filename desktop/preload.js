// The only door between the web app and the machine it is running on.
//
// Four verbs, each of them a thing the browser cannot do: pick a file to open,
// write a file back to where it came from, save a picture or any other file
// the app produced where the user says, and hear the menu. Everything else the app does - the whole calculation
// core, the state, the drawing - is unchanged web code and needs nothing from
// here.
//
// `contextBridge` rather than a global: the renderer gets these functions
// and no way to reach `ipcRenderer`, `require`, or the file system behind them.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("elamxDesktop", {
  /** Marks the app as running in the shell rather than in a browser tab. */
  platform: process.platform,

  /**
   * Opens a project through the system dialog.
   * Resolves to null when the dialog was dismissed.
   */
  openProject: (suggestedPath) => ipcRenderer.invoke("project:open", suggestedPath ?? null),

  /**
   * Writes the project. With a `filePath` the shell handed out - one that was
   * opened or chosen in its dialogs - it overwrites that file silently, which
   * is what Save means outside a browser; otherwise it asks where.
   */
  saveProject: (xml, filePath, suggestedName) =>
    ipcRenderer.invoke("project:save", { xml, filePath: filePath ?? null, suggestedName }),

  /** Saves a PNG the app has already rendered. Kept beside `saveFile` for
   *  callers written before it. */
  saveImage: (bytes, suggestedName) =>
    ipcRenderer.invoke("image:save", { data: bytes, suggestedName }),

  /**
   * Saves any file the app has produced. `kinds` ("png", "svg", "csv", "pdf", "json")
   * are the filters the dialog offers; the main process owns what they mean.
   */
  saveFile: (bytes, suggestedName, kinds) =>
    ipcRenderer.invoke("file:save", { data: bytes, suggestedName, kinds }),

  /** Keeps the native menu in the language the app is in. */
  setLocale: (locale) => ipcRenderer.send("desktop:locale", locale),

  /** Says the renderer is up, so a double-clicked file can be delivered. */
  ready: () => ipcRenderer.send("desktop:ready"),

  /**
   * Menu commands: "new", "open", "save", "saveAs", "undo", "redo". The menu
   * deliberately does not act on its own - it asks the app to run the same
   * code its buttons do.
   */
  onCommand: (handler) => {
    const listener = (_event, name) => handler(name);
    ipcRenderer.on("desktop:command", listener);
    return () => ipcRenderer.off("desktop:command", listener);
  },

  /** Runs the focused text field's own undo or redo, for a menu command the
   *  app decided belongs to the field. */
  nativeEdit: (action) => ipcRenderer.send("desktop:nativeEdit", action),

  /** A project the shell handed us, from a double-click or the command line. */
  onProjectOpened: (handler) => {
    const listener = (_event, project) => handler(project);
    ipcRenderer.on("project:opened", listener);
    return () => ipcRenderer.off("project:opened", listener);
  },
});
