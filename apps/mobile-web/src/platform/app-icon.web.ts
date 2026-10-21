import type { AccentId } from "@/ui/colors";
import { getItem, setItem } from "./storage";

// Web: the tab's icon follows the accent once the user chooses one (see
// app-icon.ts), remembered for the next visit.

const KEY = "ostrich-app-icon";

let defaultIcon: string | null = null;

function show(accent: AccentId) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');

  if (!link) {
    return;
  }

  defaultIcon ??= link.href;
  link.href = accent === "mono" ? defaultIcon : `/app-icons/icon-${accent}.png`;
}

export function setAppIcon(accent: AccentId) {
  setItem(KEY, accent);
  show(accent);
}

export function restoreAppIcon() {
  getItem(KEY).then((accent) => {
    if (accent && /^[a-z]+$/.test(accent)) {
      show(accent as AccentId);
    }
  });
}
