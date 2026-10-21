import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { AppState, Platform, Pressable, StyleSheet, Text } from "react-native";
import Animated from "react-native-reanimated";
import { disappearAlive, getDisappear, type DisappearStatus } from "@/api/api";
import { useRealtime } from "@/api/realtime-context";
import { useAuth } from "@/features/auth/auth";
import { formatDate } from "@/ui/format";
import { useAppTheme } from "@/ui/theme";
import { enterStyle, useMotion } from "@/ui/motion";

// "If I disappear": messages written ahead, sent for the user by the
// server when they have not opened Ostrich for the days they chose
// (backend disappear.ts). Opening the app on any device tells the server
// "I'm here", and the days start again.

// The last status, for the settings screen and the banner.
let status: DisappearStatus | null = null;
// The warning that had been sent when the user came back (1–3), shown once.
let cameBack = 0;
const listeners = new Set<() => void>();

export function setDisappearStatus(next: DisappearStatus) {
  status = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useDisappearStatus() {
  return useSyncExternalStore(subscribe, () => status);
}

function useCameBack() {
  return useSyncExternalStore(subscribe, () => cameBack);
}

// Once in this long at most, while the app is open.
const ALIVE_EVERY_MS = 10 * 60 * 1000;

// Tells the server the user is here when the app opens or comes to the
// front; keeps the status up to date. Mounted once, in the chats' layout.
export function DisappearWatch() {
  const { withToken, state } = useAuth();
  const { subscribeEvents } = useRealtime();
  const signedIn = state.status === "signedIn";
  const last = useRef(0);

  const alive = useCallback(() => {
    if (Date.now() - last.current < ALIVE_EVERY_MS) {
      return;
    }

    last.current = Date.now();
    withToken(disappearAlive).then(
      (result) => {
        if (result.was_warned > 0) {
          cameBack = result.was_warned;
        }

        setDisappearStatus(result);
      },
      () => {
        // Tried again next time.
        last.current = 0;
      },
    );
  }, [withToken]);

  useEffect(() => {
    if (!signedIn) {
      return;
    }

    alive();

    if (Platform.OS === "web") {
      const onVisible = () => document.visibilityState === "visible" && alive();
      document.addEventListener("visibilitychange", onVisible);
      return () => document.removeEventListener("visibilitychange", onVisible);
    }

    const subscription = AppState.addEventListener(
      "change",
      (appState) => appState === "active" && alive(),
    );
    return () => subscription.remove();
  }, [signedIn, alive]);

  // Changed on another device, or a warning: loaded again.
  useEffect(
    () =>
      subscribeEvents({
        onEvent: (event) => {
          if (event.type === "disappear") {
            withToken(getDisappear).then(setDisappearStatus, () => {});
          }
        },
      }),
    [subscribeEvents, withToken],
  );

  return null;
}

const WARNED = ["", "a week", "a day", "an hour"];

// Over the chats list: the user came back after a warning, or the switch
// went off while they were away.
export function DisappearBanner() {
  const { colors } = useAppTheme();
  const motion = useMotion();
  const router = useRouter();
  const current = useDisappearStatus();
  const back = useCameBack();
  const [dismissed, setDismissed] = useState<string | null>(null);

  const triggered = current?.switch?.triggered_at ?? null;
  const key = triggered ? `off:${triggered}` : back > 0 ? `back:${back}` : null;

  if (!key || dismissed === key) {
    return null;
  }

  const text = triggered
    ? `"If I disappear" went off on ${formatDate(triggered)}: your messages were sent. Turn it on again in Settings.`
    : `Welcome back. Your "If I disappear" messages were less than ${WARNED[back]} from being sent; the days start again now.`;

  const dismiss = () => {
    setDismissed(key);

    if (!triggered) {
      cameBack = 0;
    }
  };

  return (
    <Animated.View
      style={[
        styles.banner,
        { backgroundColor: colors.accentSoft },
        enterStyle("pop", motion),
      ]}
    >
      <Ionicons
        name={triggered ? "paper-plane-outline" : "hand-left-outline"}
        size={18}
        color={colors.accent}
      />
      <Pressable
        style={styles.text}
        onPress={() => router.push("/chats/settings/disappear")}
        accessibilityRole="button"
      >
        <Text style={[styles.label, { color: colors.text }]}>{text}</Text>
      </Pressable>
      <Pressable
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={8}
      >
        <Ionicons name="close" size={18} color={colors.muted} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },

  text: {
    flex: 1,
  },

  label: {
    fontSize: 13,
    lineHeight: 18,
  },
});
