import { reloadAppAsync } from "expo";

// Starts the app again from scratch (after the device was wiped).
export function reloadApp() {
  reloadAppAsync().catch(() => {});
}
