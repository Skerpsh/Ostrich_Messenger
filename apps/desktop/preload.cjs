// The only things the pages get from the desktop app: its version and how
// its updates go (main.js), as window.ostrichDesktop for Settings
// (apps/mobile-web/src/platform/desktop.ts), and the system's keyring to
// encrypt their storage with (platform/storage.web.ts). CommonJS: sandboxed preloads
// cannot be modules.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ostrichDesktop", {
  updateState: () => ipcRenderer.invoke("ostrich:update-state"),
  checkForUpdates: () => ipcRenderer.invoke("ostrich:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("ostrich:install-update"),
  // Base64, or null without a keyring; decrypt throws if it cannot.
  encrypt: (text) => ipcRenderer.invoke("ostrich:encrypt", text),
  decrypt: (data) => ipcRenderer.invoke("ostrich:decrypt", data),
  // Calls back on each change; returns what stops it.
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("ostrich:update-state", listener);
    return () => ipcRenderer.removeListener("ostrich:update-state", listener);
  },
});
