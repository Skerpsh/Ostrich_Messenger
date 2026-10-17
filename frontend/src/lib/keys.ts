import { useEffect, useRef } from "react";
import { Platform } from "react-native";

// Keyboard shortcuts of the web app (the apps have no keyboard to speak of).

// ⌘ on a Mac, Ctrl elsewhere.
export const isMac =
  Platform.OS === "web" && typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export const MOD_KEY = isMac ? "⌘" : "Ctrl";

export const hasMod = (event: KeyboardEvent) => (isMac ? event.metaKey : event.ctrlKey);

// Shown in the settings.
export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: `${MOD_KEY} K`, action: "Search chats" },
  { keys: "Alt ↑ / Alt ↓", action: "Previous / next chat" },
  { keys: "↑", action: "Edit your last message (in an empty message field)" },
  { keys: "Enter / Shift Enter", action: "Send / new line" },
  { keys: "Esc", action: "Cancel a reply or edit, then close the chat" },
];

// Calls the handler on every key pressed on the page (web only); it
// returns true when it used the key, which then does nothing else.
export function useKeydown(handler: (event: KeyboardEvent) => boolean | void) {
  const current = useRef(handler);

  useEffect(() => {
    current.current = handler;
  });

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && current.current(event)) {
        event.preventDefault();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
