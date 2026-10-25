import { useEffect, useState } from "react";
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AppHeader from "@/ui/app-header";
import Button from "@/ui/button";
import { Swap } from "@/ui/reveal";
import { hasMod, useKeydown } from "@/ui/keys";
import { useAppTheme } from "@/ui/theme";
import { useAuth } from "@/features/auth/auth";
import { enterPin, lockNow, useLock, WIPE_AFTER } from "./lock";
import { lockSeemsOff, setLockSeemsOff } from "./duress";
import { pausePushNotifications, syncPushToken } from "@/platform/notifications";
import PinPad from "./pin-pad";

// In front of everything while the app is locked (app/_layout.tsx).
export function LockScreen() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { wipeDevice } = useAuth();
  const router = useRouter();
  const { config, failures } = useLock();
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const waiting = failures.until > now;

  // The waiting counts down.
  useEffect(() => {
    if (!waiting) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const wipe = async () => {
    setWiping(true);
    await wipeDevice();
  };

  const submit = async (pin: string) => {
    const result = await enterPin(pin);
    setNow(Date.now());

    // Each opening starts with the lock as it really is.
    if (result.kind === "unlock" || result.kind === "duress") {
      setLockSeemsOff(false);
    }

    switch (result.kind) {
      case "unlock":
        setError(null);
        return true;
      case "duress":
        // Nothing of what was open before (it may be a hidden chat).
        setError(null);
        if (router.canDismiss()) {
          router.dismissAll();
        }
        router.replace("/chats");
        return true;
      case "wipe":
        await wipe();
        return true;
      case "wait":
        setError(`Wait ${formatWait(result.waitUntil - Date.now())} before trying again`);
        return false;
      case "wrong": {
        const left = WIPE_AFTER - result.failures;
        const warning =
          config?.wipeAfterTries && result.failures >= 5
            ? ` ${left} more wrong ${left === 1 ? "PIN wipes" : "PINs wipe"} Ostrich from this device.`
            : "";

        setError(`Wrong PIN.${warning}`);
        return false;
      }
    }
  };

  // While waiting: what the last PIN was (the warning with it) and how long.
  const countdown = waiting ? `Try again in ${formatWait(failures.until - now)}.` : null;
  const shown = waiting && error?.startsWith("Wait") ? null : error;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader brand title="Ostrich" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Swap id={wiping ? "wiping" : forgot ? "forgot" : "pin"}>
          {wiping ? (
            <Text style={[styles.text, { color: colors.textSoft }]}>Wiping Ostrich from this device…</Text>
          ) : forgot ? (
            <View style={styles.forgot}>
              <Text style={[styles.title, { color: colors.text }]}>Forgot your PIN?</Text>
              <Text style={[styles.text, { color: colors.textSoft }]}>
                Ostrich can only log out of this device: everything it keeps here is removed. Your account and messages
                stay; log in again with your username, password and OstrichID (or a QR code from another device).
              </Text>
              <Button title="Log out of this device" variant="danger" onPress={wipe} />
              <Button title="Back" variant="secondary" onPress={() => setForgot(false)} />
            </View>
          ) : (
            <PinPad
              title="Enter your PIN"
              message={countdown}
              error={shown && countdown ? `${shown} ${countdown}` : shown}
              onComplete={submit}
            >
              <Pressable onPress={() => setForgot(true)} accessibilityRole="button" hitSlop={8}>
                <Text style={[styles.link, { color: colors.muted }]}>Forgot your PIN?</Text>
              </Pressable>
            </PinPad>
          )}
        </Swap>
      </ScrollView>
    </View>
  );
}

function formatWait(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);

  return minutes > 0 ? `${minutes}:${String(seconds % 60).padStart(2, "0")}` : `${seconds} s`;
}

// Locks the app after it was in the background for the time chosen, and
// on Ctrl/⌘ L (web). Mounted once while signed in.
export function LockWatch() {
  const { config, locked, duress, opened } = useLock();
  const { withToken } = useAuth();
  const background = config?.background ?? null;

  // Push notifications paused while opened with the duress PIN, back with
  // the real one.
  useEffect(() => {
    if (opened === 0) {
      return;
    }

    (duress ? pausePushNotifications : syncPushToken)(withToken).catch(() => {});
  }, [opened, duress, withToken]);

  useEffect(() => {
    if (!config) {
      return;
    }

    let hiddenAt: number | null = null;

    const hide = () => {
      // "Turned off" with the duress PIN: it must not lock now.
      if (lockSeemsOff()) {
        return;
      }

      hiddenAt = Date.now();

      // "Immediately": locked already, so the app switcher shows no chats.
      if (background === 0) {
        lockNow();
      }
    };

    const show = () => {
      if (hiddenAt !== null && background !== null && Date.now() - hiddenAt >= background * 60_000) {
        lockNow();
      }

      hiddenAt = null;
    };

    if (Platform.OS === "web") {
      const onVisibility = () => (document.visibilityState === "hidden" ? hide() : show());
      document.addEventListener("visibilitychange", onVisibility);
      return () => document.removeEventListener("visibilitychange", onVisibility);
    }

    const subscription = AppState.addEventListener("change", (appState) =>
      appState === "active" ? show() : appState === "background" ? hide() : undefined,
    );
    return () => subscription.remove();
  }, [config, background]);

  useKeydown((event) => {
    if (config && !locked && !lockSeemsOff() && hasMod(event) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "l") {
      lockNow();
      return true;
    }
  });

  return null;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },

  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },

  forgot: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
    gap: 16,
  },

  title: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },

  text: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },

  link: {
    fontSize: 14,
  },
});
