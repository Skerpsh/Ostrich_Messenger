// The only thing the pages get from the desktop app: its version and how
// its updates go (main.js), as window.ostrichDesktop for Settings
// (apps/mobile-web/src/platform/desktop.ts). CommonJS: sandboxed preloads
// cannot be modules.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ostrichDesktop", {
  updateState: () => ipcRenderer.invoke("ostrich:update-state"),
  checkForUpdates: () => ipcRenderer.invoke("ostrich:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("ostrich:install-update"),
  // Calls back on each change; returns what stops it.
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("ostrich:update-state", listener);
    return () => ipcRenderer.removeListener("ostrich:update-state", listener);
  },
});
