import { useEffect, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";

// The phones: a new version of the app's code comes over the air (EAS
// Update, published with each release), downloaded in the background and
// used from the next start, or at once with "Restart". A release that
// changed the native part cannot come that way (its runtime differs): on
// Android the new APK is offered from the GitHub release.

const RELEASES = "https://api.github.com/repos/Skerpsh/Ostrich_Messenger/releases/latest";
const APK = "https://github.com/Skerpsh/Ostrich_Messenger/releases/latest/download/Ostrich-Android.apk";

// At most this often, when the app comes to the front.
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;

export type AppUpdate =
  | { kind: "restart"; apply: () => void }
  | { kind: "download"; version: string; apply: () => void };

// "1.5.10" > "1.5.9".
export function newerVersion(a: string, b: string) {
  const parts = (v: string) => v.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];

  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) {
      return (x[i] ?? 0) > (y[i] ?? 0);
    }
  }

  return false;
}

async function latestRelease(): Promise<string | null> {
  try {
    const response = await fetch(RELEASES, { headers: { Accept: "application/vnd.github+json" } });
    const release = await response.json();

    return typeof release?.tag_name === "string" ? release.tag_name : null;
  } catch {
    return null;
  }
}

let checkedAt = 0;

// What there is to update to, if anything (null also when asked recently).
async function checkForUpdate(): Promise<AppUpdate | null> {
  if (__DEV__ || !Updates.isEnabled || Date.now() - checkedAt < CHECK_EVERY_MS) {
    return null;
  }

  checkedAt = Date.now();

  try {
    const result = await Updates.checkForUpdateAsync();

    if (result.isAvailable) {
      await Updates.fetchUpdateAsync();
      return { kind: "restart", apply: () => Updates.reloadAsync().catch(() => {}) };
    }
  } catch {
    // Offline or the server did not answer: asked again later.
    checkedAt = 0;
    return null;
  }

  // The code running is this version's (the update's own, after one).
  const running = Constants.expoConfig?.version;
  const latest = Platform.OS === "android" ? await latestRelease() : null;

  return running && latest && newerVersion(latest, running)
    ? { kind: "download", version: latest.replace(/^v/, ""), apply: () => Linking.openURL(APK) }
    : null;
}

export function useAppUpdate(): AppUpdate | null {
  const [update, setUpdate] = useState<AppUpdate | null>(null);

  useEffect(() => {
    const check = () => checkForUpdate().then((found) => found && setUpdate(found));

    check();
    const subscription = AppState.addEventListener("change", (state) => state === "active" && check());

    return () => subscription.remove();
  }, []);

  return update;
}
