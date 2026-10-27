import { useEffect, useState, useSyncExternalStore } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { getDrandSignature } from "@/api/api";
import { serverNow } from "@/api/server-clock";
import { useAuth } from "@/features/auth/auth";
import { useAppTheme } from "@/ui/theme";
import { enterStyle, useMotion } from "@/ui/motion";
import Animated from "react-native-reanimated";
import { decodePayload, type Payload } from "./payload";
import { openingTime, openLetter, type SealedLetter } from "./sealed";
import { Swap } from "@/ui/reveal";
import PressScale from "@/ui/press-scale";

// Sealed letters in a chat: they open by themselves when their round
// comes (the server's clock says when), and stay open for the session.

export type LetterState =
  | { status: "opening" }
  | { status: "opened"; payload: Payload }
  | { status: "failed"; error: string };

// By message id, for every chat; replaced on every change.
let letters = new Map<string, LetterState>();
const listeners = new Set<() => void>();

// null: forgotten (a failure, to be tried again).
function setLetter(id: string, state: LetterState | null) {
  letters = new Map(letters);

  if (state) {
    letters.set(id, state);
  } else {
    letters.delete(id);
  }

  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// A failed opening (drand or the network) is tried again after this.
const RETRY_MS = 15_000;
// setTimeout's longest wait.
const MAX_WAIT_MS = 2 ** 31 - 1;

// The states of the letters among `sealed` (message id → letter), opening
// each when its time comes.
export function useSealedLetters(sealed: Map<string, SealedLetter>) {
  const { withToken } = useAuth();
  const snapshot = useSyncExternalStore(subscribe, () => letters);
  // Re-checked when the next letter is due.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const now = serverNow();
    let next = Infinity;

    for (const [id, letter] of sealed) {
      const state = letters.get(id);
      const at = openingTime(letter.round);

      if (state?.status === "opened" || state?.status === "opening") {
        continue;
      }

      if (state?.status === "failed") {
        next = Math.min(next, now + RETRY_MS);
        continue;
      }

      if (at > now) {
        next = Math.min(next, at);
        continue;
      }

      setLetter(id, { status: "opening" });
      openLetter(letter, (round) => withToken((token) => getDrandSignature(token, round))).then(
        (inner) => {
          // A letter inside a letter is not opened again.
          const { sealed: _nested, ...payload } = decodePayload(inner);
          setLetter(id, { status: "opened", payload });
        },
        (e) => setLetter(id, { status: "failed", error: e instanceof Error ? e.message : "It could not be opened" }),
      );
    }

    if (next === Infinity) {
      return;
    }

    // A little after the round, for the server to have its signature.
    const timer = setTimeout(() => {
      for (const [id] of sealed) {
        if (letters.get(id)?.status === "failed") {
          setLetter(id, null);
        }
      }

      setTick((t) => t + 1);
    }, Math.min(Math.max(next - now + 1_500, 1_000), MAX_WAIT_MS));

    return () => clearTimeout(timer);
  }, [sealed, tick, withToken]);

  return snapshot;
}

const pad = (n: number) => String(n).padStart(2, "0");

// "31.12.2030 at 18:00".
export function formatOpening(time: number) {
  const d = new Date(time);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} at ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "in 2 years 3 months", "in 5 days 4 h", "in 3 h 12 min", "in 45 s".
export function formatCountdown(ms: number) {
  const s = Math.max(Math.ceil(ms / 1000), 0);
  const days = Math.floor(s / 86_400);

  if (days >= 365) {
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    return `in ${years} ${years === 1 ? "year" : "years"}${months ? ` ${months} ${months === 1 ? "month" : "months"}` : ""}`;
  }

  if (days >= 30) {
    const months = Math.floor(days / 30);
    return `in ${months} ${months === 1 ? "month" : "months"}${days % 30 ? ` ${days % 30} d` : ""}`;
  }

  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);

  if (days > 0) {
    return `in ${days} ${days === 1 ? "day" : "days"}${hours ? ` ${hours} h` : ""}`;
  }

  if (hours > 0) {
    return `in ${hours} h ${minutes} min`;
  }

  return minutes > 0 ? `in ${minutes} min ${s % 60} s` : `in ${s} s`;
}

// Re-renders every second within the last hour, else every minute.
function useCountdown(at: number) {
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    const left = at - now;

    if (left <= 0) {
      return;
    }

    const timer = setTimeout(() => setNow(serverNow()), left < 3_600_000 ? 1_000 : 60_000);
    return () => clearTimeout(timer);
  }, [at, now]);

  return at - now;
}

// The envelope of a letter not opened yet. `deliverAt`: a surprise the
// others do not have yet (only its sender sees it).
export function SealedEnvelope({
  letter,
  state,
  own,
  deliverAt,
}: {
  letter: SealedLetter;
  state: LetterState | undefined;
  own: boolean;
  deliverAt?: string | null;
}) {
  const { colors } = useAppTheme();
  const at = openingTime(letter.round);
  const left = useCountdown(at);
  const color = own ? colors.onAccent : colors.text;
  const soft = own ? colors.onAccent : colors.muted;

  const detail =
    state?.status === "failed"
      ? `Not opened yet: ${state.error}. Trying again…`
      : left > 0
        ? `Opens ${formatCountdown(left)}`
        : "Opening…";

  return (
    <View style={styles.envelope} accessibilityLabel={`Sealed letter, opens ${formatOpening(at)}`}>
      <View style={[styles.icon, { backgroundColor: own ? "rgba(0, 0, 0, 0.14)" : colors.accentSoft }]}>
        <Swap id={left <= 0 && state?.status !== "failed" ? "opening" : "waiting"} resize={false}>
          {left <= 0 && state?.status !== "failed" ? (
          <ActivityIndicator size="small" color={own ? colors.onAccent : colors.accent} />
        ) : (
          <Ionicons name={letter.surprise ? "gift" : "mail"} size={20} color={own ? colors.onAccent : colors.accent} />
        )}
        </Swap>
      </View>
      <View style={styles.texts}>
        <Text style={[styles.title, { color }]}>{letter.surprise ? "Surprise letter" : "Sealed letter"}</Text>
        <Text style={[styles.detail, { color: soft }]}>{formatOpening(at)}</Text>
        <Text style={[styles.detail, { color: soft }]}>{detail}</Text>
        {deliverAt ? (
          <Text style={[styles.detail, { color: soft }]}>
            Only you see it until then: it arrives as a surprise.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// Over an opened letter's contents.
export function OpenedNote({ letter, own, onPress }: { letter: SealedLetter; own: boolean; onPress?: () => void }) {
  const { colors } = useAppTheme();
  const motion = useMotion();
  const color = own ? colors.onAccent : colors.accent;

  return (
    <Animated.View style={enterStyle("pop", motion)}>
      <PressScale scale={0.97} onPress={onPress} disabled={!onPress} style={styles.opened}>
        <Ionicons name="lock-open" size={12} color={color} />
        <Text style={[styles.openedText, { color }]}>
          {letter.surprise ? "Surprise letter" : "Sealed letter"}, opened {formatOpening(openingTime(letter.round))}
        </Text>
      </PressScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  envelope: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 2,
    paddingRight: 6,
  },

  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },

  texts: {
    flexShrink: 1,
    gap: 1,
  },

  title: {
    fontSize: 15,
    fontWeight: "600",
  },

  detail: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },

  opened: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },

  openedText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
