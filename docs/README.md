# Ostrich on each system

| System | App | Where | How it is built |
|---|---|---|---|
| Android | Expo app | [`apps/mobile-web`](../apps/mobile-web) | EAS: `npx eas-cli build --platform android --profile preview` (an APK) |
| iOS | Expo app | [`apps/mobile-web`](../apps/mobile-web) | EAS: `npx eas-cli build --platform ios --profile production` |
| Web (PWA) | Expo app | [`apps/mobile-web`](../apps/mobile-web) | `npm run build:web`, published by [`deploy/deploy.sh`](../deploy/deploy.sh) |
| Windows, Linux | desktop app (planned) | [`apps/desktop`](../apps/desktop) | Electron around the web build |
| Linux, macOS, Windows terminal | CLI | [`apps/cli`](../apps/cli) | `go build`; releases on version tags (`.github/workflows/release-cli.yml`) |
| Server | API and WebSockets | [`apps/server`](../apps/server) | `npm run build`, run by systemd, see [`deploy/`](../deploy) |

## Code that must match

The apps talk to the same server and read each other's messages, so a few
things are written twice, in TypeScript and in Go, and checked against the
same vectors in [`shared/test-vectors`](../shared/test-vectors):

- the encryption: `apps/mobile-web/src/crypto/crypto.ts` and `apps/cli/crypto.go`
- the message format: `apps/mobile-web/src/features/chat/payload.ts` and `apps/cli/payload.go`
- the markup (**bold**, mentions): `apps/mobile-web/src/features/chat/markup.ts` and `apps/cli/markup.go`

## Inside the Expo app

`apps/mobile-web/src` is laid out by what the code is for:

- `app/` the screens (expo-router: the file names are the routes)
- `features/<name>/` everything of one part of the app: its screens' parts,
  its state (`*-context.tsx`, `chats.tsx`) and its logic
- `crypto/`, `api/` no UI; the same on every system
- `ui/` the building blocks every screen uses
- `platform/` what differs between the phones and the web: `storage.ts` for
  the phones next to `storage.web.ts` for the web, and so on. Expo picks the
  right file; screens just import `@/platform/storage`.
