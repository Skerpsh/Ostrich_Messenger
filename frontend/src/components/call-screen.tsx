import { useEffect, useState, type ReactNode } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ChatAvatar from "@/components/chat-avatar";
import IconButton, { type IconName } from "@/components/icon-button";
import { useCalls } from "@/context/calls";
import { useAppTheme } from "@/context/theme";
import { formatDuration } from "@/lib/attachments";
import type { CallView, HandshakeView } from "@/lib/calls";
import { phraseEmoji, phraseText, type Phrase } from "@/lib/handshake";
import { useIsWide } from "@/lib/layout";
import { callSounds } from "@/lib/webrtc";
import { radius } from "@/theme/colors";

// The call over every screen (context/calls.tsx): ringing, the call's
// buttons, the Ostrich handshake; minimized, a bar at the top.
export default function CallScreen() {
  const { call, minimized, setMinimized, hangUp } = useCalls();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  const now = useNow(call?.phase === "active" || call?.phase === "reconnecting");

  if (!call) {
    return null;
  }

  const status = statusText(call, now);

  if (minimized && call.phase !== "incoming" && call.phase !== "ended") {
    return (
      <View pointerEvents="box-none" style={[styles.barWrap, { top: insets.top + 8 }]}>
        <Pressable
          onPress={() => setMinimized(false)}
          accessibilityRole="button"
          accessibilityLabel={`Back to the call with @${call.chat.username}`}
          style={[styles.bar, { backgroundColor: colors.online }]}
        >
          <Ionicons name="call" size={16} color="#08240f" />
          <Text numberOfLines={1} style={styles.barText}>
            @{call.chat.username} · {status}
          </Text>
          <Pressable onPress={hangUp} accessibilityRole="button" accessibilityLabel="Hang up" hitSlop={8}>
            <Ionicons name="close-circle" size={20} color="#08240f" />
          </Pressable>
        </Pressable>
      </View>
    );
  }

  const screen = (
    <View
      style={[
        styles.screen,
        wide
          ? [styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]
          : [styles.flex, { backgroundColor: colors.surface, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }],
      ]}
    >
      <View style={styles.top}>
        {call.phase !== "incoming" && call.phase !== "ended" ? (
          <IconButton icon="chevron-down" label="Minimize the call" onPress={() => setMinimized(true)} />
        ) : (
          <View style={styles.topSpacer} />
        )}
        <View style={styles.secure}>
          <Ionicons name="lock-closed" size={12} color={colors.muted} />
          <Text style={[styles.secureText, { color: colors.muted }]}>End-to-end encrypted</Text>
        </View>
        <View style={styles.topSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.middle} showsVerticalScrollIndicator={false}>
        <Pulse active={call.phase === "outgoing" || call.phase === "incoming"} color={colors.accent}>
          <ChatAvatar chat={call.chat} size={112} />
        </Pulse>
        <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
          @{call.chat.username}
        </Text>
        <Text style={[styles.status, { color: call.phase === "ended" ? colors.danger : colors.textSoft }]}>{status}</Text>
        {call.peerMuted && call.phase !== "ended" ? (
          <View style={[styles.chip, { backgroundColor: colors.panelAlt }]}>
            <Ionicons name="mic-off" size={13} color={colors.muted} />
            <Text style={[styles.chipText, { color: colors.muted }]}>@{call.chat.username} is muted</Text>
          </View>
        ) : null}

        {call.handshake && (call.phase === "active" || call.phase === "reconnecting") ? (
          <Handshake handshake={call.handshake} username={call.chat.username ?? "…"} />
        ) : null}
      </ScrollView>

      <Controls call={call} />
    </View>
  );

  return wide ? <View style={styles.backdrop}>{screen}</View> : <View style={styles.full}>{screen}</View>;
}

function statusText(call: CallView, now: number) {
  switch (call.phase) {
    case "outgoing":
      return "Calling…";
    case "incoming":
      return "Incoming call";
    case "connecting":
      return "Connecting…";
    case "active":
      return formatDuration(now - (call.connectedAt ?? now));
    case "reconnecting":
      return "Reconnecting…";
    case "ended":
      return call.endText ?? "Call ended";
  }
}

function Controls({ call }: { call: CallView }) {
  const { accept, decline, hangUp, toggleMute, toggleSpeaker } = useCalls();
  const { colors } = useAppTheme();

  if (call.phase === "ended") {
    return <View style={styles.controls} />;
  }

  if (call.phase === "incoming") {
    return (
      <View style={styles.controls}>
        <RoundButton icon="close" label="Decline" color="#ffffff" background={colors.danger} onPress={decline} />
        <RoundButton icon="call" label="Answer" color="#08240f" background={colors.online} onPress={accept} />
      </View>
    );
  }

  return (
    <View style={styles.controls}>
      <RoundButton
        icon={call.muted ? "mic-off" : "mic"}
        label={call.muted ? "Unmute" : "Mute"}
        color={call.muted ? colors.surface : colors.text}
        background={call.muted ? colors.text : colors.panelAlt}
        onPress={toggleMute}
      />
      {callSounds.canUseSpeaker ? (
        <RoundButton
          icon={call.speaker ? "volume-high" : "volume-medium-outline"}
          label="Speaker"
          color={call.speaker ? colors.surface : colors.text}
          background={call.speaker ? colors.text : colors.panelAlt}
          onPress={toggleSpeaker}
        />
      ) : null}
      <RoundButton icon="call" label="Hang up" color="#ffffff" background={colors.danger} onPress={hangUp} rotate />
    </View>
  );
}

function RoundButton({
  icon,
  label,
  color,
  background,
  onPress,
  rotate = false,
}: {
  icon: IconName;
  label: string;
  color: string;
  background: string;
  onPress: () => void;
  // The receiver put down: hang up.
  rotate?: boolean;
}) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.roundWrap}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.round, { backgroundColor: background, opacity: pressed ? 0.8 : 1 }]}
      >
        <Ionicons name={icon} size={28} color={color} style={rotate ? styles.rotated : undefined} />
      </Pressable>
      <Text style={[styles.roundLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

// --- the Ostrich handshake (lib/handshake.ts) ---

function Handshake({ handshake, username }: { handshake: HandshakeView; username: string }) {
  const { pickPhrase } = useCalls();
  const { colors } = useAppTheme();
  const [open, setOpen] = useState(false);

  if (handshake.broken) {
    return (
      <View style={[styles.handshake, { backgroundColor: colors.panel, borderColor: colors.danger }]}>
        <Text style={[styles.verdict, { color: colors.danger }]}>
          ⚠ This call&apos;s handshake failed: someone may be in the middle. Hang up and compare the safety code in the chat.
        </Text>
      </View>
    );
  }

  const both = handshake.heard === "right" && handshake.peerHeard === "right";

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        style={[styles.handshake, styles.handshakeRow, { backgroundColor: colors.panel, borderColor: colors.line }]}
      >
        <Image source={require("@/assets/images/Giuseppe.png")} style={styles.ostrich} contentFit="contain" />
        <View style={styles.flex}>
          <Text style={[styles.handshakeTitle, { color: colors.text }]}>
            {both ? "Verified: just the two of you" : "Ostrich handshake"}
          </Text>
          <Text style={[styles.handshakeHint, { color: colors.muted }]}>
            {both ? "You both heard each other's sentence" : "Check together that nobody is listening in"}
          </Text>
        </View>
        <Ionicons name={both ? "shield-checkmark" : "chevron-forward"} size={20} color={both ? colors.online : colors.muted} />
      </Pressable>
    );
  }

  return (
    <View style={[styles.handshake, { backgroundColor: colors.panel, borderColor: both ? colors.online : colors.line }]}>
      <View style={styles.handshakeRow}>
        <Image source={require("@/assets/images/Giuseppe.png")} style={styles.ostrich} contentFit="contain" />
        <Text style={[styles.handshakeTitle, styles.flex, { color: colors.text }]}>Ostrich handshake</Text>
        <IconButton icon="chevron-up" label="Hide the handshake" size={18} onPress={() => setOpen(false)} />
      </View>

      <Text style={[styles.step, { color: colors.muted }]}>1 · Read this aloud to @{username}</Text>
      <View style={[styles.mine, { backgroundColor: colors.accentSoft }]}>
        <Text style={styles.mineEmoji}>{phraseEmoji(handshake.mine)}</Text>
        <Text style={[styles.mineText, { color: colors.text }]}>{phraseText(handshake.mine)}</Text>
      </View>
      <PeerVerdict heard={handshake.peerHeard} username={username} />

      <Text style={[styles.step, { color: colors.muted }]}>2 · Which one does @{username} read to you?</Text>
      {handshake.heard === null ? (
        <>
          {handshake.choices.map((choice) => (
            <Choice key={choice.join("-")} phrase={choice} onPress={() => pickPhrase(choice)} />
          ))}
          <Pressable onPress={() => pickPhrase(null)} accessibilityRole="button" style={styles.none}>
            <Text style={[styles.noneText, { color: colors.muted }]}>None of these</Text>
          </Pressable>
        </>
      ) : handshake.heard === "right" ? (
        <Text style={[styles.verdict, { color: colors.online }]}>
          ✓ That&apos;s @{username}&apos;s sentence: nobody is in the middle of this call.
        </Text>
      ) : (
        <Text style={[styles.verdict, { color: colors.danger }]}>
          ⚠ That&apos;s not the sentence of this call. Someone may be listening in: hang up and compare the safety code
          in the chat.
        </Text>
      )}
    </View>
  );
}

function PeerVerdict({ heard, username }: { heard: "right" | "wrong" | null; username: string }) {
  const { colors } = useAppTheme();

  if (heard === null) {
    return null;
  }

  return (
    <Text style={[styles.peerVerdict, { color: heard === "right" ? colors.online : colors.danger }]}>
      {heard === "right" ? `✓ @${username} found your sentence too` : `⚠ @${username} didn't find your sentence`}
    </Text>
  );
}

function Choice({ phrase, onPress }: { phrase: Phrase; onPress: () => void }) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={phraseText(phrase)}
      style={({ pressed }) => [
        styles.choice,
        { backgroundColor: pressed ? colors.hover : colors.panelAlt },
      ]}
    >
      <Text style={styles.choiceEmoji}>{phraseEmoji(phrase)}</Text>
      <Text style={[styles.choiceText, { color: colors.text }]}>{phraseText(phrase)}</Text>
    </Pressable>
  );
}

// --- helpers ---

// The current time, every second while `ticking`.
function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!ticking) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [ticking]);

  return now;
}

// A ring spreading around the avatar while the call rings.
function Pulse({ active, color, children }: { active: boolean; color: string; children: ReactNode }) {
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!active) {
      progress.stopAnimation();
      progress.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: Platform.OS !== "web",
      }),
    );

    loop.start();

    return () => loop.stop();
  }, [active, progress]);

  return (
    <View style={styles.pulse}>
      {active ? (
        <Animated.View
          style={[
            styles.pulseRing,
            {
              borderColor: color,
              opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
              transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
            },
          ]}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  full: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 50,
  },

  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 50,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },

  screen: {
    paddingHorizontal: 20,
  },

  card: {
    width: "100%",
    maxWidth: 440,
    height: "100%",
    maxHeight: 760,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 16,
  },

  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  topSpacer: {
    width: 40,
  },

  secure: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },

  secureText: {
    fontSize: 12,
  },

  middle: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
    gap: 8,
  },

  pulse: {
    width: 150,
    height: 150,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },

  pulseRing: {
    position: "absolute",
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 3,
  },

  name: {
    fontSize: 24,
    fontWeight: "700",
  },

  status: {
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },

  chipText: {
    fontSize: 12,
  },

  controls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 28,
    minHeight: 96,
    paddingTop: 8,
  },

  roundWrap: {
    alignItems: "center",
    gap: 6,
  },

  round: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },

  rotated: {
    transform: [{ rotate: "135deg" }],
  },

  roundLabel: {
    fontSize: 12,
  },

  handshake: {
    alignSelf: "stretch",
    marginTop: 16,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },

  handshakeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  ostrich: {
    width: 32,
    height: 32,
  },

  flex: {
    flex: 1,
  },

  handshakeTitle: {
    fontSize: 15,
    fontWeight: "700",
  },

  handshakeHint: {
    fontSize: 13,
  },

  step: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
  },

  mine: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 6,
  },

  mineEmoji: {
    fontSize: 34,
  },

  mineText: {
    fontSize: 19,
    fontWeight: "700",
    textAlign: "center",
  },

  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },

  choiceEmoji: {
    fontSize: 20,
  },

  choiceText: {
    flex: 1,
    fontSize: 15,
  },

  none: {
    alignSelf: "center",
    paddingVertical: 6,
  },

  noneText: {
    fontSize: 14,
    textDecorationLine: "underline",
  },

  verdict: {
    fontSize: 14,
    lineHeight: 20,
  },

  peerVerdict: {
    fontSize: 13,
    textAlign: "center",
  },

  barWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 50,
    alignItems: "center",
  },

  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: 360,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    boxShadow: "0 4px 14px rgba(0, 0, 0, 0.25)",
  },

  barText: {
    flexShrink: 1,
    color: "#08240f",
    fontSize: 14,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
});
