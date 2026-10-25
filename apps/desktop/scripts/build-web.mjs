// Builds the web app (apps/mobile-web) into web/, which the desktop app
// carries inside: npm run web. The app's code then comes with the release,
// not from the server, so the server cannot swap the encryption code.
//
// Its pages live at app://ostrich, so links to invites and profiles must
// point at the web app's real address: EXPO_PUBLIC_WEB_URL, Ostrich's site
// unless set. EXPO_PUBLIC_API_URL picks another server, as for the web.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mobileWeb = path.join(desktop, "..", "mobile-web");
const out = path.join(desktop, "web");

const env = {
  ...process.env,
  EXPO_PUBLIC_WEB_URL: process.env.EXPO_PUBLIC_WEB_URL || "https://ostrich-messenger.online",
  // Shown in Settings: the desktop app's version (the release's, set by
  // release.yml with npm version).
  EXPO_PUBLIC_APP_VERSION: JSON.parse(readFileSync(path.join(desktop, "package.json"), "utf8")).version,
};
const run = (command, args) => execFileSync(command, args, { cwd: mobileWeb, env, stdio: "inherit", shell: process.platform === "win32" });

rmSync(out, { recursive: true, force: true });
run("npx", ["expo", "export", "--platform", "web", "--output-dir", out]);
run("node", ["scripts/add-csp.mjs", out]);
