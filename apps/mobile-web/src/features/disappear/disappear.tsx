import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { AppState, Platform, StyleSheet, Text } from "react-native";
import {
  deleteDisappearMessage,
  disappearAlive,
  getDisappear,
  saveDisappearMessage,
  setDisappear,
  turnOffDisappear,
  type DisappearStatus,
} from "@/api/api";
import { changeFake, fakeDisappear } from "@/features/lock/duress";
import { inDuress, useLock } from "@/features/lock/lock";
import { useRealtime } from "@/api/realtime-context";
import { useAuth } from "@/features/auth/auth";
import { formatDate } from "@/ui/format";
import { useAppTheme } from "@/ui/theme";
import PressScale from "@/ui/press-scale";
import { Appear } from "@/ui/reveal";

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

// The requests of the settings: opened with the duress PIN, they read and
// change the made-up switch (features/lock/duress.ts) instead.
export const disappearApi = {
  get: (token: string) => (inDuress() ? Promise.resolve(fakeDisappear()) : getDisappear(token)),

  set: async (token: string, days: number) => {
    if (!inDuress()) {
      return setDisappear(token, days);
    }

    await changeFake((fake) => ({ ...fake, disappear: { days, messages: fake.disappear?.messages ?? [] } }));
    return fakeDisappear();
  },

  turnOff: async (token: string) => {
    if (!inDuress()) {
      return turnOffDisappear(token);
    }

    await changeFake((fake) => ({ ...fake, disappear: null }));
    return fakeDisappear();
  },

  saveMessage: async (token: string, message: Parameters<typeof saveDisappearMessage>[1]) => {
    if (!inDuress()) {
      return saveDisappearMessage(token, message);
    }

    await changeFake((fake) => ({
      ...fake,
      disappear: fake.disappear && {
        ...fake.disappear,
        messages: [
          ...fake.disappear.messages.filter((m) => m.id !== message.id),
          { id: message.id, chatId: message.chatId, content: message.content, minutesAgo: 0 },
        ],
      },
    }));
    return fakeDisappear();
  },

  deleteMessage: async (token: string, id: string) => {
    if (!inDuress()) {
      return deleteDisappearMessage(token, id);
    }

    await changeFake((fake) => ({
      ...fake,
      disappear: fake.disappear && { ...fake.disappear, messages: fake.disappear.messages.filter((m) => m.id !== id) },
    }));
    return fakeDisappear();
  },
};

// Once in this long at most, while the app is open.
const ALIVE_EVERY_MS = 10 * 60 * 1000;

// Tells the server the user is here when the app opens or comes to the
// front; keeps the status up to date. Mounted once, in the chats' layout.
export function DisappearWatch() {
  const { withToken, state } = useAuth();
  const { subscribeEvents } = useRealtime();
  const signedIn = state.status === "signedIn";
  const last = useRef(0);
  const { opened } = useLock();

  // Opened the other way (duress PIN or real PIN): shown again.
  useEffect(() => {
    if (signedIn && opened > 0) {
      withToken(disappearApi.get).then(setDisappearStatus, () => {});
    }
  }, [signedIn, opened, withToken]);

  const alive = useCallback(() => {
    if (Date.now() - last.current < ALIVE_EVERY_MS) {
      return;
    }

    last.current = Date.now();
    withToken(disappearAlive).then(
      (result) => {
        // The user is here either way; what shows is made up then.
        if (inDuress()) {
          setDisappearStatus(fakeDisappear());
          return;
        }

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
            withToken(disappearApi.get).then(setDisappearStatus, () => {});
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
    <Appear kind="pop"
      style={[
        styles.banner,
        { backgroundColor: colors.accentSoft },
      ]}
    >
      <Ionicons
        name={triggered ? "paper-plane-outline" : "hand-left-outline"}
        size={18}
        color={colors.accent}
      />
      <PressScale scale={0.98}
        style={styles.text}
        onPress={() => router.push("/chats/settings/disappear")}
        accessibilityRole="button"
      >
        <Text style={[styles.label, { color: colors.text }]}>{text}</Text>
      </PressScale>
      <PressScale scale={0.85}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={8}
      >
        <Ionicons name="close" size={18} color={colors.muted} />
      </PressScale>
    </Appear>
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
