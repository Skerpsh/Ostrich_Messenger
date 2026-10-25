import { useEffect, useState } from "react";
import { Platform } from "react-native";

// What the desktop app (apps/desktop/preload.cjs) tells the pages: how its
// updates go. Not there on the web and the phones.

export type DesktopUpdateState = {
  // "unsupported": the package cannot update itself (Flatpak, the AUR).
  state: "idle" | "unsupported" | "checking" | "latest" | "downloading" | "ready" | "error";
  // The new version, while downloading and once ready.
  version?: string;
  percent?: number;
  message?: string;
  // Installed when the app quits (AppImage, Windows); else on restart.
  silent?: boolean;
  current: string;
};

type Bridge = {
  updateState: () => Promise<DesktopUpdateState>;
  checkForUpdates: () => Promise<DesktopUpdateState>;
  installUpdate: () => Promise<unknown>;
  onUpdateState: (callback: (state: DesktopUpdateState) => void) => () => void;
};

export const desktop: Bridge | null =
  Platform.OS === "web" && typeof window !== "undefined"
    ? ((window as unknown as { ostrichDesktop?: Bridge }).ostrichDesktop ?? null)
    : null;

export function useDesktopUpdate() {
  const [state, setState] = useState<DesktopUpdateState | null>(null);

  useEffect(() => {
    if (!desktop) {
      return;
    }

    desktop.updateState().then(setState, () => {});
    return desktop.onUpdateState(setState);
  }, []);

  return state;
}
