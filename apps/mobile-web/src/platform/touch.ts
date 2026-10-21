import { Platform } from "react-native";

// Phones and tablets, also their browsers (a finger rather than a mouse).
// Their keyboard covers half the screen, so no field takes the focus by
// itself there: the keyboard opens when the user taps one.
export const TOUCH_UI =
  Platform.OS !== "web" ||
  (typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches));
