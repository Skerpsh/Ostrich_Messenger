// Ostrich for Windows and Linux: the web app (built into web/, see
// scripts/build-web.mjs) in a window of its own, with what a desktop
// messenger needs on top: an icon in the tray with the unread count, a
// window that hides there instead of quitting, ostrich:// links, and
// updates from the GitHub releases (AppImage, Windows).
import { app, BrowserWindow, Menu, nativeImage, net, protocol, session, shell, Tray } from "electron";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import updater from "electron-updater";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "web");
// The pages' address. The server allows it (apps/server/src/server.ts).
const ORIGIN = "app://ostrich";
const ICON = path.join(HERE, "web", "icon-512.png");
const BOUNDS_FILE = path.join(app.getPath("userData"), "window.json");

// --hidden: start in the tray (when started with the system).
const startHidden = process.argv.includes("--hidden");

let window = null;
let tray = null;
let quitting = false;

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

  createWindow();
  createTray();
  openLink(process.argv.find((arg) => arg.startsWith("ostrich://")));

  // New versions from the GitHub releases, where the format can update
  // itself (the .deb and .rpm are updated by downloading the new one).
  if (app.isPackaged && (process.env.APPIMAGE || process.platform === "win32")) {
    updater.autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }
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
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Ostrich", click: showWindow },
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
  tray.on("click", () => (window?.isVisible() && window.isFocused() ? window.hide() : showWindow()));
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
