import { AppState, Platform } from "react-native";
import { getAppIconName, setAlternateAppIcon, supportsAlternateIcons } from "expo-alternate-app-icons";
import type { AccentId } from "@/theme/colors";

// The app's icon follows the accent once the user chooses one: an icon per
// accent (assets/images/app-icons, app.json), the default one for Mono.
// iOS tells the user the icon changed. The web implementation (the tab's
// icon) lives in app-icon.web.ts.

const iconName = (accent: AccentId) =>
  accent === "mono" ? null : `Accent${accent[0].toUpperCase()}${accent.slice(1)}`;

// Android: switching the icon closes the app on some launchers, so it is
// switched when the app goes to the background.
let pending: string | null | undefined;

AppState.addEventListener("change", (state) => {
  if (state === "background" && pending !== undefined) {
    const name = pending;
    pending = undefined;
    setAlternateAppIcon(name).catch(() => {});
  }
});

export function setAppIcon(accent: AccentId) {
  if (!supportsAlternateIcons) {
    return;
  }

  const name = iconName(accent);

  if (Platform.OS === "android") {
    pending = getAppIconName() === name ? undefined : name;
    return;
  }

  if (getAppIconName() !== name) {
    setAlternateAppIcon(name).catch(() => {});
  }
}

// The phones keep the icon themselves.
export function restoreAppIcon() {}
