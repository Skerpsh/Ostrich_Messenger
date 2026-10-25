// Ostrich for Windows and Linux: the web app (built into web/, see
// scripts/build-web.mjs) in a window of its own, with what a desktop
// messenger needs on top: an icon in the tray with the unread count, a
// window that hides there instead of quitting, ostrich:// links, and
// updates from the GitHub releases.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, Notification, protocol, session, shell, Tray } from "electron";
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import updater from "electron-updater";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "web");
// The pages' address. The server allows it (apps/server/src/server.ts).
const ORIGIN = "app://ostrich";
const ICON = path.join(HERE, "web", "icon-512.png");
const BOUNDS_FILE = path.join(app.getPath("userData"), "window.json");
const LOG_FILE = path.join(app.getPath("userData"), "updates.log");

// --hidden: start in the tray (when started with the system).
const startHidden = process.argv.includes("--hidden");

// It stays open in the tray for days: new versions are looked for this
// often, not only at start.
const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;
// The first check, a moment after start: right away, Chromium often still
// sees the network changing (VPNs, containers) and fails the download.
const UPDATE_FIRST_MS = 10 * 1000;
// After a failed check: 30 s, then twice as long each time, up to 15 min.
const UPDATE_RETRY_MS = 30 * 1000;
const UPDATE_RETRY_MAX_MS = 15 * 60 * 1000;

let window = null;
let tray = null;
let quitting = false;
// A new version downloaded and waiting: "Restart to update" in the tray.
let updateReady = null;
// What the updater does, for Settings: "unsupported" (Flatpak, the AUR,
// not packaged), "checking", "latest", "downloading", "ready", "error".
let updateState = { state: "idle" };
let retryTimer = null;
let retries = 0;

// app://ostrich behaves like an https site: its own origin for storage,
// fetch and the API's CORS.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// One Ostrich at a time: starting it again (or opening an ostrich:// link)
// brings the open one forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    showWindow();
    openLink(argv.find((arg) => arg.startsWith("ostrich://")));
  });

  app.whenReady().then(start);
}

function start() {
  // Windows: notifications are shown under this name.
  app.setAppUserModelId("com.ostrich.messenger");
  app.setAsDefaultProtocolClient("ostrich");

  // The web build's files; any other path is a screen of the app, which
  // index.html shows (the app routes itself).
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    // Normalized first: "/../" cannot leave web/.
    const file = path.join(WEB, path.normalize(decodeURIComponent(pathname)));
    const served = file.startsWith(WEB + path.sep) && isFile(file) ? file : path.join(WEB, "index.html");

    return net.fetch(pathToFileURL(served).href);
  });

  // The camera and the microphone (calls, voice messages, QR codes) and
  // notifications; nothing else.
  const allowed = new Set(["media", "notifications", "clipboard-sanitized-write", "fullscreen"]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));

  // First: Settings may ask how the updates go as soon as it opens.
  startUpdates();
  createWindow();
  createTray();
  openLink(process.argv.find((arg) => arg.startsWith("ostrich://")));
}

// The package this is: "appimage", "deb", "rpm", "pacman", "windows", or
// null where it cannot update itself (Flatpak, not packaged).
function packageType() {
  if (!app.isPackaged || process.env.FLATPAK_ID) {
    return null;
  }

  if (process.platform === "win32") {
    return "windows";
  }

  if (process.env.APPIMAGE) {
    return "appimage";
  }

  // electron-builder leaves it in the .deb, .rpm and .pacman (the AUR
  // package removes it: pacman updates that one).
  try {
    const type = readFileSync(path.join(process.resourcesPath, "package-type"), "utf8").trim();
    return ["deb", "rpm", "pacman"].includes(type) ? type : null;
  } catch {
    return null;
  }
}

// New versions from the GitHub releases (latest.yml, latest-linux.yml),
// downloaded in the background. The AppImage and Windows install them when
// the app quits; the .deb, .rpm and .pacman ask for the password
// (pkexec), so only when the user restarts to update. Settings shows how it
// goes (preload.cjs), and updates.log in the app's folder keeps it.
function startUpdates() {
  const type = packageType();

  ipcMain.handle("ostrich:update-state", () => updateState);
  ipcMain.handle("ostrich:check-for-updates", () => checkForUpdates());
  ipcMain.handle("ostrich:install-update", () => updateState.state === "ready" && installUpdate());

  if (!type) {
    setUpdateState({ state: "unsupported" });
    return;
  }

  const { autoUpdater } = updater;
  const silent = type === "appimage" || type === "windows";
  autoUpdater.autoInstallOnAppQuit = silent;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

  autoUpdater.on("checking-for-update", () => setUpdateState({ state: "checking" }));
  autoUpdater.on("update-not-available", () => {
    retries = 0;
    setUpdateState({ state: "latest" });
  });
  autoUpdater.on("update-available", (info) => setUpdateState({ state: "downloading", version: info.version, percent: 0 }));
  autoUpdater.on("download-progress", (progress) =>
    setUpdateState({ ...updateState, state: "downloading", percent: Math.floor(progress.percent) }),
  );

  // A failed check or download (offline, the network changing) is tried
  // again soon, not in UPDATE_CHECK_MS.
  autoUpdater.on("error", (error) => {
    setUpdateState({ state: "error", message: String(error?.message ?? error).split("\n")[0] });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(checkForUpdates, Math.min(UPDATE_RETRY_MS * 2 ** retries, UPDATE_RETRY_MAX_MS));
    retries++;
  });

  autoUpdater.on("update-downloaded", (info) => {
    retries = 0;
    const first = updateReady !== info.version;
    updateReady = info.version;
    setUpdateState({ state: "ready", version: info.version, silent });
    updateTrayMenu();

    if (first && Notification.isSupported()) {
      const notice = new Notification({
        title: `Ostrich ${info.version} is ready`,
        body: silent
          ? "It is installed when you quit Ostrich. Click to restart now."
          : "Click to restart and install it (your password is asked).",
        icon: ICON,
      });

      notice.on("click", installUpdate);
      notice.show();
    }
  });

  setTimeout(checkForUpdates, UPDATE_FIRST_MS);
  setInterval(checkForUpdates, UPDATE_CHECK_MS);
}

function checkForUpdates() {
  // Downloaded already: nothing to look for until it is installed.
  if (updateState.state === "unsupported" || updateState.state === "ready") {
    return updateState;
  }

  // Asked again by hand: the next failure is retried soon again.
  clearTimeout(retryTimer);
  updater.autoUpdater.checkForUpdates().catch(() => {});

  return updateState;
}

function setUpdateState(next) {
  updateState = { ...next, current: app.getVersion() };
  log(`update: ${JSON.stringify(updateState)}`);
  window?.webContents.send("ostrich:update-state", updateState);
}

// updates.log, up to about 100 kB (then started again).
function log(message) {
  try {
    if (statSync(LOG_FILE, { throwIfNoEntry: false })?.size > 100_000) {
      writeFileSync(LOG_FILE, "");
    }

    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`);
  } catch {}
}

function installUpdate() {
  quitting = true;
  // Not silent: the installer of Windows shows its progress; the app is
  // started again after it.
  updater.autoUpdater.quitAndInstall(false, true);
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function createWindow() {
  const bounds = readBounds();

  window = new BrowserWindow({
    ...bounds,
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: "Ostrich",
    icon: ICON,
    backgroundColor: "#111111",
    autoHideMenuBar: true,
    webPreferences: {
      // window.ostrichDesktop: the version and the updates, for Settings.
      preload: path.join(HERE, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  window.removeMenu();
  window.loadURL(`${ORIGIN}/chats`);

  window.once("ready-to-show", () => {
    if (!startHidden) {
      window.show();
    }
  });

  // Links to other sites open in the browser; the app stays on its pages.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) {
      event.preventDefault();
      openOutside(url);
    }
  });

  // The web app puts the unread count in the title: "(3) Ostrich".
  window.on("page-title-updated", (event, title) => {
    event.preventDefault();
    showUnread(Number(/^\((\d+)\)/.exec(title)?.[1] ?? 0));
  });

  // Closing hides it in the tray, so messages keep coming; Quit in the
  // tray's menu quits.
  window.on("close", (event) => {
    saveBounds();

    if (!quitting && tray) {
      event.preventDefault();
      window.hide();
    }
  });
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 }));
  } catch {
    // No tray on this desktop: closing the window quits then.
    tray = null;
    return;
  }

  tray.setToolTip("Ostrich");
  updateTrayMenu();
  tray.on("click", () => (window?.isVisible() && window.isFocused() ? window.hide() : showWindow()));
}

function updateTrayMenu() {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Ostrich", click: showWindow },
      ...(updateReady ? [{ label: `Restart to update to ${updateReady}`, click: installUpdate }] : []),
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function showWindow() {
  if (!window) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.focus();
}

function showUnread(count) {
  window?.setTitle(count > 0 ? `(${count}) Ostrich` : "Ostrich");
  tray?.setToolTip(count > 0 ? `Ostrich: ${count} unread` : "Ostrich");
  app.setBadgeCount(count);
}

// ostrich://chats/join/TOKEN, ostrich://chats/u/USERNAME: the same screens
// as the web app's links.
function openLink(link) {
  if (!link || !window) {
    return;
  }

  const route = link.replace(/^ostrich:\/\/\/?/, "");

  if (/^chats\/(join|u)\/[^/?#]+$/.test(route)) {
    window.loadURL(`${ORIGIN}/${route}`);
    showWindow();
  }
}

function openOutside(url) {
  if (/^(https?|mailto):/.test(url)) {
    shell.openExternal(url);
  }
}

function readBounds() {
  try {
    const { width, height, x, y } = JSON.parse(readFileSync(BOUNDS_FILE, "utf8"));
    return { width, height, x, y };
  } catch {
    return { width: 1100, height: 760 };
  }
}

function saveBounds() {
  if (window && !window.isMinimized() && !window.isMaximized()) {
    try {
      writeFileSync(BOUNDS_FILE, JSON.stringify(window.getBounds()));
    } catch {}
  }
}

app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", () => {
  app.quit();
});
