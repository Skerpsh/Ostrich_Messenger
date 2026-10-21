# Ostrich for Windows and Linux

A desktop app in its own window, like Telegram Desktop: not the terminal client
([`apps/cli`](../cli)) and not a browser tab.

**Status: planned.** Nothing is built here yet.

## The plan

- **Electron**, around the web build of [`apps/mobile-web`](../mobile-web)
  (`npm run build:web`), so the desktop app is the same app as the web one.
  Electron ships Chromium, so calls (WebRTC) work on Linux too; with the
  system's WebKitGTK (Tauri) they would not.
- What the desktop adds to the web app: an icon in the tray, notifications
  from the system, starting with the system, `ostrich://` links opening the
  app, a window that remembers its size.
- Packages: an installer for Windows (`.exe`), AppImage and `.deb` for Linux.
- The server address is the same setting as the web app's
  (`EXPO_PUBLIC_API_URL` when building).
