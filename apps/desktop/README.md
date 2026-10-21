# Ostrich for Windows and Linux

A desktop app in its own window, like Telegram Desktop: not the terminal client
([`apps/cli`](../cli)) and not a browser tab.

It is **Electron around the web app** ([`apps/mobile-web`](../mobile-web)): the
same screens, built into the package. The app's code (the encryption among it)
comes with the release, not from the server each time it opens, so the server
cannot swap it. Electron ships Chromium, so calls (WebRTC) work on Linux too.

On top of the web app:

- an icon in the **tray** with the unread count; closing the window hides it
  there, so messages keep coming (Quit in the tray's menu quits)
- notifications from the system, the camera and the microphone (nothing else
  is allowed)
- **`ostrich://` links** (`ostrich://chats/join/…`, `ostrich://chats/u/…`)
  open the screen in the running app
- the window remembers its size and place
- **updates** from the GitHub releases: the AppImage and the Windows app update
  themselves; a new `.deb` or `.rpm` is installed over the old one
- `--hidden` starts it in the tray

## Building

```bash
cd apps/desktop
npm install
npm run web      # builds apps/mobile-web into web/
npm start        # runs it
npm run dist     # packages for this system into dist/
```

`npm run web` uses Ostrich's server; `EXPO_PUBLIC_API_URL=https://chat.example.com npm run web`
builds it for another one (`EXPO_PUBLIC_WEB_URL` too if the web app is elsewhere: invite and
profile links point there).

The pages are served from `app://ostrich` (see `main.js`); the server always allows that origin
(`apps/server/src/server.ts`).

## Releases

Each version tag builds and publishes it with the other apps
([`.github/workflows/release.yml`](../../.github/workflows/release.yml)):
`Ostrich-Linux.AppImage`, `.deb`, `.rpm` and `.flatpak`, and `Ostrich-Windows-Setup.exe`, plus
`latest-linux.yml` and `latest.yml`, which the installed apps read to update themselves.
The packages are not signed: Windows warns about an unknown publisher the first time.
