import type { AppUpdate } from "./app-update";

// Web: the service worker brings the new version with each deploy
// (platform/pwa.ts); the desktop app updates itself (apps/desktop).
export type { AppUpdate } from "./app-update";

export function useAppUpdate(): AppUpdate | null {
  return null;
}
