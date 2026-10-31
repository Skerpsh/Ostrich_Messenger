import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

// A light buzz under the finger at moments that matter (a long press, a
// swipe far enough, a wrong PIN). Android's own haptics follow the system's
// "Touch feedback" setting, iOS's its "System haptics"; the web has none.
// Never awaited: a phone without a vibrator just stays still.
const ANDROID = {
  tap: Haptics.AndroidHaptics.Virtual_Key,
  tick: Haptics.AndroidHaptics.Segment_Tick,
  hold: Haptics.AndroidHaptics.Long_Press,
  done: Haptics.AndroidHaptics.Confirm,
  wrong: Haptics.AndroidHaptics.Reject,
};

export type Haptic = keyof typeof ANDROID;

export function haptic(kind: Haptic) {
  if (Platform.OS === "android") {
    Haptics.performAndroidHapticsAsync(ANDROID[kind]).catch(() => {});
  } else if (Platform.OS === "ios") {
    (kind === "tick"
      ? Haptics.selectionAsync()
      : kind === "done"
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : kind === "wrong"
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
          : Haptics.impactAsync(kind === "hold" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light)
    ).catch(() => {});
  }
}
