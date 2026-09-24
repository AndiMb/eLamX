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

const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require("electron");
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

// What the page may load and run. Everything the app needs comes from its own
// origin; the exceptions are the wasm module, which needs 'wasm-unsafe-eval' to
// compile, inline styles (KaTeX and React write style attributes), and the
// data:/blob: URLs the charts, fonts and exports are built from. Sent as a
// header here and as a meta tag by the web build, which is the part a browser
// tab sees - the header also carries frame-ancestors, which a meta tag cannot.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

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
/** The language the menu was last built in, which the dialogs follow too. */
let menuLocale = "de";
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
    denyPermissions();
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
    // read the rest of the disk. Asked as a relative path rather than as a
    // string prefix: `startsWith(WEB_ROOT)` also accepts a sibling directory
    // whose name merely begins with it (".../web/dist-old" beside
    // ".../web/dist"), which is not what the check means to allow.
    const relative = path.relative(WEB_ROOT, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return new Response("Not found", { status: 404 });
    }
    const response = await net.fetch(pathToFileURL(target).toString());
    const type = CONTENT_TYPES.get(path.extname(target).toLowerCase());
    if (!type) return response;
    const headers = new Headers(response.headers);
    headers.set("Content-Type", type);
    if (type === "text/html") headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    return new Response(response.body, { status: response.status, headers });
  });
}

/**
 * Refuses every permission a page can ask for.
 *
 * Electron grants them all unless told otherwise - camera, microphone,
 * location, notifications, serial ports - and a laminate calculator needs none.
 * Writing to the clipboard is the one exception the app uses (copying a table
 * or a layup); reading it happens through the paste event, which needs no
 * permission.
 */
function denyPermissions() {
  const allowed = new Set(["clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(allowed.has(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
}

/** What may be handed to the operating system to open. */
const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Opens a link in the user's real browser.
 *
 * `shell.openExternal` does whatever the OS associates with the scheme, which
 * on Windows includes schemes that start a program - so it is given a URL only
 * after the scheme has been checked against the three a link in this app can
 * legitimately carry. Everything else is dropped rather than launched: the
 * links here are ours, and one that is not is not a link we want to follow.
 */
function openInBrowser(url) {
  let scheme;
  try {
    scheme = new URL(url).protocol;
  } catch {
    return;
  }
  if (EXTERNAL_SCHEMES.has(scheme)) void shell.openExternal(url);
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
    openInBrowser(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${SCHEME}://`)) {
      event.preventDefault();
      openInBrowser(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(START_URL);
  buildMenu("de");
}

// --- what the renderer may ask for ----------------------------------------

/**
 * Whether a message comes from the app's own page.
 *
 * There is one window and it cannot navigate away from `app://`, so today every
 * message does. The check is here so that a frame nobody planned for - an
 * embedded document, a navigation this file failed to stop - cannot use the
 * channels below.
 */
function fromApp(event) {
  const url = event.senderFrame?.url;
  if (!url) return false;
  try {
    const { protocol: scheme, host } = new URL(url);
    return scheme === `${SCHEME}:` && host === "elamx";
  } catch {
    return false;
  }
}

/**
 * The files this process has handed the page or had the user choose, and so
 * the only ones Save may overwrite without asking.
 *
 * The page names the file to save to, and without this list whatever runs in
 * the page could name any file at all - a start-up script, say - and have it
 * written with no dialog in between. With it, a path the shell never gave out
 * is answered with the Save As dialog instead, which is what the user sees
 * anyway the first time a project is saved.
 */
const grantedPaths = new Set();

function grant(filePath) {
  grantedPaths.add(path.resolve(filePath));
}

function isGranted(filePath) {
  return typeof filePath === "string" && grantedPaths.has(path.resolve(filePath));
}

ipcMain.handle("project:open", async (event, suggested) => {
  if (!fromApp(event)) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: label(menuLocale, "open"),
    defaultPath: typeof suggested === "string" ? suggested : undefined,
    filters: PROJECT_FILTERS,
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return readProject(result.filePaths[0]);
});

ipcMain.handle("project:save", async (event, request) => {
  if (!fromApp(event)) return null;
  const { xml, filePath, suggestedName } = request ?? {};
  if (typeof xml !== "string") throw new TypeError("project:save expects the project as text");
  // With a path we already own, Save means save - no dialog. That is the whole
  // difference from the browser, where every save is a fresh download.
  let target = isGranted(filePath) ? filePath : null;
  if (!target) {
    const name = typeof suggestedName === "string" && suggestedName ? suggestedName : "eLamX";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: label(menuLocale, "saveAs"),
      defaultPath: `${name}.elamx`,
      filters: PROJECT_FILTERS,
    });
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
    grant(target);
  }
  await fs.writeFile(target, xml, "utf8");
  return { filePath: target, name: path.basename(target, ".elamx") };
});

// What the save dialog offers per kind of file. The renderer names kinds from
// this list and nothing else: which filters a native dialog shows is this
// process's decision, not something a page hands in.
const FILE_KINDS = {
  png: { name: "PNG", extensions: ["png"] },
  svg: { name: "SVG", extensions: ["svg"] },
  csv: { name: "CSV", extensions: ["csv"] },
  pdf: { name: "PDF", extensions: ["pdf"] },
  json: { name: "JSON", extensions: ["json"] },
};

async function saveFile(data, suggestedName, kinds) {
  const filters = (Array.isArray(kinds) ? kinds : [])
    .filter((kind) => Object.hasOwn(FILE_KINDS, kind))
    .map((kind) => FILE_KINDS[kind]);
  const pictures = filters.length > 0 && filters.every((f) => f === FILE_KINDS.png || f === FILE_KINDS.svg);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: label(menuLocale, pictures ? "saveImage" : "saveFile"),
    defaultPath: suggestedName,
    filters: filters.length > 0 ? filters : [FILE_KINDS.png],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, Buffer.from(data));
  return result.filePath;
}

ipcMain.handle("file:save", (event, { data, suggestedName, kinds }) =>
  fromApp(event) ? saveFile(data, suggestedName, kinds) : null,
);

// The channel from before `file:save`, kept as what it always was - a PNG.
ipcMain.handle("image:save", (event, { data, suggestedName }) =>
  fromApp(event) ? saveFile(data, suggestedName, ["png"]) : null,
);

// The menu is built in this process, which has none of the app's message
// catalogs - so the renderer tells it which language it is in, and the menu is
// rebuilt when that changes. One language setting, not two.
ipcMain.on("desktop:locale", (event, locale) => {
  if (fromApp(event)) buildMenu(locale === "en" ? "en" : "de");
});

// Undo or redo that belongs to a text field rather than to the project: the
// renderer decided so, and only the shell can run the field's own editing.
ipcMain.on("desktop:nativeEdit", (event, action) => {
  if (!fromApp(event)) return;
  if (action === "undo") event.sender.undo();
  else if (action === "redo") event.sender.redo();
});

ipcMain.on("desktop:ready", (event) => {
  if (!fromApp(event)) return;
  if (pendingOpen) void deliverProject(pendingOpen);
  pendingOpen = null;
});

async function readProject(filePath) {
  const xml = await fs.readFile(filePath, "utf8");
  grant(filePath);
  return {
    xml,
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
    newProject: "Neues Projekt",
    open: "Öffnen …",
    save: "Speichern",
    saveAs: "Speichern unter …",
    saveImage: "Bild speichern",
    saveFile: "Datei speichern",
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
    report: "Report erstellen …",
  },
  en: {
    file: "File",
    newProject: "New project",
    open: "Open …",
    save: "Save",
    saveAs: "Save as …",
    saveImage: "Save the picture",
    saveFile: "Save the file",
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
    report: "Create report …",
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
  menuLocale = locale;
  const text = (key) => label(locale, key);
  const command = (name) => () => mainWindow?.webContents.send("desktop:command", name);

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: text("file"),
        submenu: [
          { label: text("newProject"), accelerator: "CmdOrCtrl+N", click: command("new") },
          { label: text("open"), accelerator: "CmdOrCtrl+O", click: command("open") },
          { label: text("save"), accelerator: "CmdOrCtrl+S", click: command("save") },
          { label: text("saveAs"), accelerator: "CmdOrCtrl+Shift+S", click: command("saveAs") },
          { type: "separator" },
          { label: text("report"), click: command("report") },
          { type: "separator" },
          { label: text("quit"), role: "quit" },
        ],
      },
      {
        label: text("edit"),
        submenu: [
          // Not the native roles: those undo the text in a field and nothing
          // else. The app decides - text in a field that was typed into, the
          // project otherwise - and hands the field's case back through
          // "desktop:nativeEdit" below.
          { label: text("undo"), accelerator: "CmdOrCtrl+Z", click: command("undo") },
          {
            label: text("redo"),
            accelerator: process.platform === "darwin" ? "Cmd+Shift+Z" : "Ctrl+Y",
            click: command("redo"),
          },
          // The other platform's redo key, which people bring with them.
          {
            label: text("redo"),
            accelerator: process.platform === "darwin" ? "Cmd+Y" : "Ctrl+Shift+Z",
            click: command("redo"),
            visible: false,
            acceleratorWorksWhenHidden: true,
          },
          { type: "separator" },
          // Cut, copy and paste keep their roles: they make the page fire its
          // own clipboard events, which a text field answers natively and the
          // layer table answers for its selected rows - the same split the
          // app makes for undo, made by the page itself.

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
