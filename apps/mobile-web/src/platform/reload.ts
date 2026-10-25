import * as Updates from "expo-updates";

// Starts the app again from scratch (after the device was wiped). Not in
// development builds, where expo-updates cannot reload.
export function reloadApp() {
  if (Updates.isEnabled) {
    Updates.reloadAsync().catch(() => {});
  }
}
