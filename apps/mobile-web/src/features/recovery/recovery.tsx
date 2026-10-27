import { useEffect, useState, useSyncExternalStore } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { StyleSheet, Text } from "react-native";
import Animated from "react-native-reanimated";
import { approveRecovery, getGuarding, getRecovery, setRecovery, type Guarding, type RecoveryPerson, type RecoveryStatus } from "@/api/api";
import { useRealtime } from "@/api/realtime-context";
import { useAuth } from "@/features/auth/auth";
import {
  deriveFromOstrichId,
  newMessageId,
  normalizeOstrichId,
  openForRecovery,
  ostrichIdBytes,
  recoveryCode,
  requestContext,
  sealForRecovery,
  shareContext,
  splitSecret,
} from "@/crypto/crypto";
import { getItem, removeItem } from "@/platform/storage";
import { formatDate, formatTime } from "@/ui/format";
import { useAppTheme } from "@/ui/theme";
import { enterStyle, useMotion } from "@/ui/motion";
import { withAlpha } from "@/ui/colors";
import { RECOVERED_KEY } from "./saved";
import { changeFake, fakeRecovery } from "@/features/lock/duress";
import { inDuress, useLock } from "@/features/lock/lock";
import PressScale from "@/ui/press-scale";

// Recovery through friends (backend recovery.ts): the user's OstrichID
// split on this device among friends ("guardians"), any `threshold` of
// whom can give it back to a new device that knows the password, a day
// after it asks (the user's devices can cancel it meanwhile). The new
// device's side is app/recover.tsx.

export const MIN_GUARDIANS = 2;
export const MAX_GUARDIANS = 10;

// The user's guardians and requests, the friends they guard, and whether
// they recovered the account on this device and have not chosen guardians
// again yet; for the settings screen and the banner.
let owner: RecoveryStatus | null = null;
let guarding: Guarding[] | null = null;
let recovered = false;
const listeners = new Set<() => void>();

const changed = () => listeners.forEach((listener) => listener());

export function setRecoveryStatus(next: RecoveryStatus) {
  owner = next;

  // Chosen again: the banner asking for it goes.
  if (next.setup && recovered) {
    recovered = false;
    removeItem(RECOVERED_KEY).catch(() => {});
  }

  changed();
}

export function setGuarding(next: Guarding[]) {
  guarding = next;
  changed();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useRecoveryStatus = () => useSyncExternalStore(subscribe, () => owner);
export const useGuarding = () => useSyncExternalStore(subscribe, () => guarding);
const useRecovered = () => useSyncExternalStore(subscribe, () => recovered);

export function loadRecovery(withToken: ReturnType<typeof useAuth>["withToken"]) {
  // Opened with the duress PIN: made-up guardians, no requests, no friends
  // to help (features/lock/duress.ts).
  if (inDuress()) {
    setRecoveryStatus(fakeRecovery());
    setGuarding([]);
    return;
  }

  withToken(getRecovery).then(setRecoveryStatus, () => {});
  withToken(getGuarding).then(setGuarding, () => {});
}

// Keeps it all up to date. Mounted once, in the chats' layout.
export function RecoveryWatch() {
  const { withToken } = useAuth();
  const { subscribeEvents } = useRealtime();
  // Loaded again when opened the other way (duress PIN or real PIN).
  const { opened } = useLock();

  useEffect(() => {
    loadRecovery(withToken);
    getItem(RECOVERED_KEY).then((value) => {
      recovered = value !== null && !owner?.setup;
      changed();
    });
  }, [withToken, opened]);

  useEffect(
    () =>
      subscribeEvents({
        onEvent: (event) => {
          if (event.type === "recovery") {
            loadRecovery(withToken);
          }
        },
      }),
    [subscribeEvents, withToken],
  );

  return null;
}

// The default for `total` guardians: more than half of them (3 of 5).
export const defaultThreshold = (total: number) => Math.max(MIN_GUARDIANS, Math.floor(total / 2) + 1);

// Splits the OstrichID (typed by the user: it is not kept on the device)
// among the guardians, each share sealed for their public key.
export async function chooseGuardians(
  token: string,
  ostrichIdInput: string,
  guardians: (RecoveryPerson & { public_key: string })[],
  threshold: number,
): Promise<RecoveryStatus> {
  const ostrichId = normalizeOstrichId(ostrichIdInput);

  if (!ostrichId) {
    throw new Error("An OstrichID has 20 letters and digits, like XXXX-XXXX-XXXX-XXXX-XXXX");
  }

  if (inDuress()) {
    await changeFake((fake) => ({
      ...fake,
      recovery: {
        threshold,
        guardians: guardians.map(({ id, username, avatar_id, is_developer }) => ({
          id,
          username,
          avatar_id,
          is_developer,
        })),
        daysAgo: 0,
      },
    }));
    return fakeRecovery();
  }

  const id = newMessageId();
  const shares = splitSecret(ostrichIdBytes(ostrichId), guardians.length, threshold);

  return setRecovery(token, {
    id,
    threshold,
    authKey: deriveFromOstrichId(ostrichId).authKey,
    shares: guardians.map((guardian, i) => {
      const sealed = sealForRecovery(guardian.public_key, shares[i], shareContext(id, guardian.id));
      return { guardian_id: guardian.id, sealed: sealed.sealed, sealer_public: sealed.publicKey };
    }),
  });
}

export const sameCode = (typed: string, publicKey: string) =>
  typed.replace(/\D/g, "") === recoveryCode(publicKey).replace(/\D/g, "");

// A guardian helps: their share, sealed again for the request's key, once
// the code the one asking read them is the request's.
export function approve(token: string, privateKey: Uint8Array, userId: string, friend: Guarding, typedCode: string) {
  const request = friend.request;

  if (!request) {
    throw new Error("There is no request to approve");
  }

  if (!sameCode(typedCode, request.public_key)) {
    throw new Error(
      "The code does not match. Do not approve: whoever asks may not be your friend, or the request was tampered with.",
    );
  }

  const share = openForRecovery(privateKey, friend.sealer_public, friend.sealed, shareContext(friend.setup_id, userId));

  return approveRecovery(token, request.id, sealForRecovery(request.public_key, share, requestContext(request.id)));
}

export const formatWhen = (iso: string) => `${formatDate(iso)} ${formatTime(iso)}`;

// Over the chats list: someone is recovering the user's account, a friend
// asks for help, or the guardians are to be chosen again.
export function RecoveryBanner() {
  const { colors } = useAppTheme();
  const motion = useMotion();
  const router = useRouter();
  const status = useRecoveryStatus();
  const friends = useGuarding();
  const again = useRecovered();
  const [dismissed, setDismissed] = useState<string | null>(null);

  const request = status?.requests[0];
  const asking = friends?.find((friend) => friend.request && !friend.request.approved);

  const shown = request
    ? {
        key: `request:${request.id}`,
        danger: true,
        icon: "warning-outline" as const,
        text: `Someone is recovering your account with your friends: they get in after ${formatWhen(request.ready_at)}. Not you? Tap to cancel it.`,
      }
    : asking
      ? {
          key: `asking:${asking.request!.id}`,
          danger: false,
          icon: "people-outline" as const,
          text: `@${asking.owner.username} asks you to help recover their account. Tap to check their code.`,
        }
      : again && status && !status.setup
        ? {
            key: "again",
            danger: false,
            icon: "shield-checkmark-outline" as const,
            text: "You have a new OstrichID, so your guardians were reset. Tap to choose them again.",
          }
        : null;

  if (!shown || dismissed === shown.key) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.banner,
        { backgroundColor: shown.danger ? withAlpha(colors.danger, 0.14) : colors.accentSoft },
        enterStyle("pop", motion),
      ]}
    >
      <Ionicons name={shown.icon} size={18} color={shown.danger ? colors.danger : colors.accent} />
      <PressScale scale={0.98} style={styles.text} onPress={() => router.push("/chats/settings/recovery")} accessibilityRole="button">
        <Text style={[styles.label, { color: colors.text }]}>{shown.text}</Text>
      </PressScale>
      <PressScale scale={0.85}
        onPress={() => setDismissed(shown.key)}
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={8}
      >
        <Ionicons name="close" size={18} color={colors.muted} />
      </PressScale>
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
