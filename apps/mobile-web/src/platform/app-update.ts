import { useEffect, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import Constants from "expo-constants";

// The phones: on Android a newer release's APK is offered from GitHub.
// Nothing comes over the air: code the phone would run without a signed
// build could read the keys (security audit SEC-001).

const RELEASES = "https://api.github.com/repos/Skerpsh/Ostrich_Messenger/releases/latest";
// The APK of a release: v1.5.0 → Ostrich-Android-1.5.0.apk.
const apkUrl = (tag: string) =>
  `https://github.com/Skerpsh/Ostrich_Messenger/releases/download/${tag}/Ostrich-Android-${tag.replace(/^v/, "")}.apk`;

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
  if (__DEV__ || Platform.OS !== "android" || Date.now() - checkedAt < CHECK_EVERY_MS) {
    return null;
  }

  checkedAt = Date.now();

  const running = Constants.expoConfig?.version;
  const latest = await latestRelease();

  // Offline or GitHub did not answer: asked again later.
  if (!latest) {
    checkedAt = 0;
  }

  return running && latest && newerVersion(latest, running)
    ? { kind: "download", version: latest.replace(/^v/, ""), apply: () => Linking.openURL(apkUrl(latest)) }
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
