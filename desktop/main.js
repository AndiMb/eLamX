// The Windows desktop shell around the web app.
//
// The app itself is unchanged: this loads the same bundle `npm run build`
// produces in ../web/dist and adds the three things a browser cannot give it -
// a real Open dialog, a Save that writes back to the file that was opened, and
// a file association so a double-clicked .elamx starts the program.
//
// It is served over a custom `app://` scheme rather than from `file://`, and
// that is not cosmetic. The calculation core runs in a MODULE worker
// (`new Worker(url, { type: "module" })`), and Chromium refuses module scripts
// over file://; the wasm module is fetched and wants a real
// `application/wasm` Content-Type, which file:// does not provide either.
// A scheme registered as standard and secure also gives the renderer a proper
// origin, so localStorage - where the whole project state lives - persists
// under a stable key instead of an opaque one.

const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");

/**
 * Where the built web app lives.
 *
 * Packaged, electron-builder has copied `web/dist` into the app's resources
 * (see `extraResources`); running from the checkout it is where `npm run
 * build` left it. Two places, because the bundle cannot live inside the asar
 * without either duplicating it in the repository or making the dev run load
 * something the build produced hours ago.
 */
const WEB_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "web")
  : path.resolve(__dirname, "..", "web", "dist");
const SCHEME = "app";
const START_URL = `${SCHEME}://elamx/index.html`;

const PROJECT_FILTERS = [
  { name: "eLamX", extensions: ["elamx"] },
  { name: "XML", extensions: ["xml"] },
];

// Chromium infers nothing useful from a custom scheme, so the types are
// spelled out. Getting `application/wasm` wrong costs streaming compilation
// and a console warning; getting the font types wrong costs the fonts.
const CONTENT_TYPES = new Map(
  Object.entries({
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".wasm": "application/wasm",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
  }),
);

// Must happen before `app.ready`, and the flags are what make the scheme
// behave like http: `standard` for a real origin, `secure` so it is a secure
// context (workers, crypto), `supportFetchAPI` because the wasm glue fetches
// its own binary.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** The .elamx path a double-click or a command line handed us, if any. */
function projectPathFrom(argv) {
  return argv.slice(1).find((argument) => argument.toLowerCase().endsWith(".elamx")) ?? null;
}

let pendingOpen = projectPathFrom(process.argv);
let mainWindow = null;

// One window, one instance: a second launch (or a double-clicked file) hands
// its path to the running program rather than starting a rival copy with its
// own copy of the project state.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const file = projectPathFrom(argv);
    if (file) void deliverProject(file);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    serveWebRoot();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function serveWebRoot() {
  protocol.handle(SCHEME, async (request) => {
    const requested = new URL(request.url).pathname;
    const target = path.join(WEB_ROOT, decodeURIComponent(requested));
    // The renderer decides these paths, so a bug there must not be able to
    // read the rest of the disk.
    if (!target.startsWith(WEB_ROOT)) {
      return new Response("Not found", { status: 404 });
    }
    const response = await net.fetch(pathToFileURL(target).toString());
    const type = CONTENT_TYPES.get(path.extname(target).toLowerCase());
    if (!type) return response;
    const headers = new Headers(response.headers);
    headers.set("Content-Type", type);
    return new Response(response.body, { status: response.status, headers });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#f4f5f7",
    title: "eLamX",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // The renderer is a web app and is treated as one: no Node, an isolated
      // context, and everything it may ask the system for goes through the
      // named channels in preload.js.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Shown only once it has something to show, so the window does not flash
  // white while the wasm module compiles.
  mainWindow.once("ready-to-show", () => mainWindow.show());

  // A desktop shell has nowhere to navigate to. Anything that tries - a link
  // in a hint, a stray target=_blank - goes to the real browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${SCHEME}://`)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(START_URL);
  buildMenu("de");
}

// --- what the renderer may ask for ----------------------------------------

ipcMain.handle("project:open", async (_event, suggested) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: label("de", "open"),
    defaultPath: suggested ?? undefined,
    filters: PROJECT_FILTERS,
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return readProject(result.filePaths[0]);
});

ipcMain.handle("project:save", async (_event, { xml, filePath, suggestedName }) => {
  // With a path we already own, Save means save - no dialog. That is the whole
  // difference from the browser, where every save is a fresh download.
  let target = filePath;
  if (!target) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: label("de", "saveAs"),
      defaultPath: `${suggestedName || "eLamX"}.elamx`,
      filters: PROJECT_FILTERS,
    });
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
  }
  await fs.writeFile(target, xml, "utf8");
  return { filePath: target, name: path.basename(target, ".elamx") };
});

ipcMain.handle("image:save", async (_event, { data, suggestedName }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: label("de", "saveImage"),
    defaultPath: suggestedName,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, Buffer.from(data));
  return result.filePath;
});

// The menu is built in this process, which has none of the app's message
// catalogs - so the renderer tells it which language it is in, and the menu is
// rebuilt when that changes. One language setting, not two.
ipcMain.on("desktop:locale", (_event, locale) => buildMenu(locale === "en" ? "en" : "de"));

ipcMain.on("desktop:ready", () => {
  if (pendingOpen) void deliverProject(pendingOpen);
  pendingOpen = null;
});

async function readProject(filePath) {
  return {
    xml: await fs.readFile(filePath, "utf8"),
    filePath,
    name: path.basename(filePath, path.extname(filePath)),
  };
}

/** Pushes a file the shell handed us into a window that may not exist yet. */
async function deliverProject(filePath) {
  if (!mainWindow) {
    pendingOpen = filePath;
    return;
  }
  try {
    mainWindow.webContents.send("project:opened", await readProject(filePath));
  } catch (error) {
    void dialog.showMessageBox(mainWindow, {
      type: "error",
      message: String(error && error.message ? error.message : error),
    });
  }
}

// --- menu -----------------------------------------------------------------

const LABELS = {
  de: {
    file: "Datei",
    open: "Öffnen …",
    save: "Speichern",
    saveAs: "Speichern unter …",
    saveImage: "Bild speichern",
    quit: "Beenden",
    view: "Ansicht",
    reload: "Neu laden",
    zoomIn: "Vergrößern",
    zoomOut: "Verkleinern",
    zoomReset: "Originalgröße",
    fullScreen: "Vollbild",
    devTools: "Entwicklerwerkzeuge",
    edit: "Bearbeiten",
    undo: "Rückgängig",
    redo: "Wiederholen",
    cut: "Ausschneiden",
    copy: "Kopieren",
    paste: "Einfügen",
    selectAll: "Alles auswählen",
  },
  en: {
    file: "File",
    open: "Open …",
    save: "Save",
    saveAs: "Save as …",
    saveImage: "Save the picture",
    quit: "Quit",
    view: "View",
    reload: "Reload",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    zoomReset: "Actual size",
    fullScreen: "Full screen",
    devTools: "Developer tools",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    selectAll: "Select all",
  },
};

function label(locale, key) {
  return (LABELS[locale] ?? LABELS.de)[key];
}

/**
 * The menu does not act on its own: every file entry sends the renderer the
 * same command its own toolbar buttons run, so there is one implementation of
 * "open" and one of "save" rather than two that can drift.
 */
function buildMenu(locale) {
  const text = (key) => label(locale, key);
  const command = (name) => () => mainWindow?.webContents.send("desktop:command", name);

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: text("file"),
        submenu: [
          { label: text("open"), accelerator: "CmdOrCtrl+O", click: command("open") },
          { label: text("save"), accelerator: "CmdOrCtrl+S", click: command("save") },
          { label: text("saveAs"), accelerator: "CmdOrCtrl+Shift+S", click: command("saveAs") },
          { type: "separator" },
          { label: text("quit"), role: "quit" },
        ],
      },
      {
        label: text("edit"),
        submenu: [
          { label: text("undo"), role: "undo" },
          { label: text("redo"), role: "redo" },
          { type: "separator" },
          { label: text("cut"), role: "cut" },
          { label: text("copy"), role: "copy" },
          { label: text("paste"), role: "paste" },
          { label: text("selectAll"), role: "selectAll" },
        ],
      },
      {
        label: text("view"),
        submenu: [
          { label: text("reload"), role: "reload" },
          { type: "separator" },
          { label: text("zoomIn"), role: "zoomIn" },
          { label: text("zoomOut"), role: "zoomOut" },
          { label: text("zoomReset"), role: "resetZoom" },
          { type: "separator" },
          { label: text("fullScreen"), role: "togglefullscreen" },
          { label: text("devTools"), role: "toggleDevTools" },
        ],
      },
    ]),
  );
}
