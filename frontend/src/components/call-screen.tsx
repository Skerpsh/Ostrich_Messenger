import { useEffect, useMemo, useState, type ReactNode } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { Animated, Easing, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CallVideo from "@/components/call-video";
import ChatAvatar from "@/components/chat-avatar";
import IconButton, { type IconName } from "@/components/icon-button";
import { useCalls } from "@/context/calls";
import { useAppTheme } from "@/context/theme";
import { useEscape } from "@/lib/keys";
import { enterStyle, LEAVE_MS, leaveStyle, useMotion } from "@/lib/motion";
import { formatDuration } from "@/lib/attachments";
import type { CallStats } from "@/lib/call-connection";
import type { CallView, HandshakeView } from "@/lib/calls";
import { phraseEmoji, phraseText, type Phrase } from "@/lib/handshake";
import { useIsWide } from "@/lib/layout";
import { getItem, setItem } from "@/lib/storage";
import { callSounds } from "@/lib/webrtc";
import { radius } from "@/theme/colors";

type Drawn = "screen" | "bar" | null;

// The call over every screen (context/calls.tsx): ringing, the call's
// buttons, the Ostrich handshake, the video; minimized, a bar at the top.
// Minimizing folds the screen into the bar (and back out of it); a call
// that is over goes the way it came.
export default function CallScreen() {
  const { call: current, minimized, setMinimized, hangUp } = useCalls();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  const motion = useMotion();
  // The call, kept for the screen to leave once it is over.
  const [kept, setKept] = useState(current);
  const call = current ?? kept;
  const now = useNow(call?.phase === "active" || call?.phase === "reconnecting");

  const wanted: Drawn = !current
    ? null
    : minimized && current.phase !== "incoming" && current.phase !== "ended"
      ? "bar"
      : "screen";
  const [drawn, setDrawn] = useState<Drawn>(wanted);
  // The screen on its way out (to the bar, or gone), and whether it came
  // out of the bar.
  const [leaving, setLeaving] = useState(false);
  const [unfolding, setUnfolding] = useState(false);

  // Following the call as it is rendered (React's way to adjust state to
  // new props).
  if (current && current !== kept) {
    setKept(current);
  }

  if (wanted !== drawn && !leaving) {
    if (drawn === "screen" && motion !== "off") {
      setLeaving(true);
    } else {
      setUnfolding(drawn === "bar" && wanted === "screen");
      setDrawn(wanted);
    }
  }

  useEffect(() => {
    if (!leaving) {
      return;
    }

    // Then drawn follows what is wanted by now (above).
    const timer = setTimeout(() => {
      setLeaving(false);
      setDrawn(null);
    }, LEAVE_MS[motion]);

    return () => clearTimeout(timer);
  }, [leaving, motion]);

  if (!call || !drawn) {
    return null;
  }

  const status = statusText(call, now);

  if (drawn === "bar") {
    return (
      <Reanimated.View pointerEvents="box-none" style={[styles.barWrap, { top: insets.top + 8 }, enterStyle("drop", motion)]}>
        <Pressable
          onPress={() => setMinimized(false)}
          accessibilityRole="button"
          accessibilityLabel={`Back to the call with @${call.chat.username}`}
          style={[styles.bar, { backgroundColor: colors.online }]}
        >
          <Ionicons name={call.camera || call.peerCamera ? "videocam" : "call"} size={16} color="#08240f" />
          <Text numberOfLines={1} style={styles.barText}>
            @{call.chat.username} · {status}
          </Text>
          <Pressable onPress={hangUp} accessibilityRole="button" accessibilityLabel="Hang up" hitSlop={8}>
            <Ionicons name="close-circle" size={20} color="#08240f" />
          </Pressable>
        </Pressable>
      </Reanimated.View>
    );
  }

  const screen = videoShown(call) ? (
    <VideoScreen call={call} status={status} wide={wide} />
  ) : (
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
        <Chips call={call} />
        {call.phase === "active" || call.phase === "reconnecting" ? (
          <Quality username={call.chat.username ?? "…"} muted={call.muted} />
        ) : null}

        {call.handshake && (call.phase === "active" || call.phase === "reconnecting") ? (
          <Handshake handshake={call.handshake} username={call.chat.username ?? "…"} />
        ) : null}
      </ScrollView>

      <Controls call={call} />
    </View>
  );

  // Opening: over a fading background on a wide screen, coming up from
  // below on a phone; out of the bar, growing from the top. Leaving the
  // same way back, or folding into the bar.
  const folding = leaving && wanted === "bar";
  const sheet = leaving
    ? leaveStyle(folding ? "fold" : wide ? "pop" : "rise", motion)
    : enterStyle(unfolding ? "unfold" : wide ? "pop" : "rise", motion);
  const origin = (folding || unfolding) && styles.fromTop;

  return wide ? (
    <Reanimated.View
      pointerEvents={leaving ? "none" : "auto"}
      style={[styles.backdrop, leaving ? leaveStyle("fade", motion) : enterStyle("fade", motion)]}
    >
      <Reanimated.View style={[styles.cardPlace, origin, sheet]}>{screen}</Reanimated.View>
    </Reanimated.View>
  ) : (
    <Reanimated.View pointerEvents={leaving ? "none" : "auto"} style={[styles.full, origin, sheet]}>
      {screen}
    </Reanimated.View>
  );
}

// Some video to show: this side's camera, or the other's.
function videoShown(call: CallView) {
  return call.phase !== "ended" && (localOn(call) || remoteOn(call));
}

const localOn = (call: CallView) => Boolean(call.camera && call.localVideo);
const remoteOn = (call: CallView) => Boolean(call.peerCamera && call.remoteVideo && call.phase !== "incoming");

// Under the name: the other side muted, a notice, the audio held back.
function Chips({ call, overlay = false }: { call: CallView; overlay?: boolean }) {
  const { colors } = useAppTheme();
  const chip = [styles.chip, { backgroundColor: overlay ? "rgba(0, 0, 0, 0.45)" : colors.panelAlt }];
  const text = [styles.chipText, { color: overlay ? "#ffffff" : colors.muted }];

  if (call.phase === "ended") {
    return null;
  }

  return (
    <>
      {call.peerMuted ? (
        <View style={chip}>
          <Ionicons name="mic-off" size={13} color={overlay ? "#ffffff" : colors.muted} />
          <Text style={text}>@{call.chat.username} is muted</Text>
        </View>
      ) : null}
      {call.notice ? (
        <View style={chip}>
          <Text style={text}>{call.notice}</Text>
        </View>
      ) : null}
      {call.audioBlocked ? <PlayAudio username={call.chat.username ?? "…"} /> : null}
    </>
  );
}

// --- video ---

type Layout = "pip" | "split";
const LAYOUT_KEY = "ostrich-call-layout";

// The call with video: the videos fill the screen, the rest floats over
// them and hides after a while (a tap brings it back).
function VideoScreen({ call, status, wide }: { call: CallView; status: string; wide: boolean }) {
  const { setMinimized } = useCalls();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [layout, setLayout] = useState<Layout>("pip");
  const [swapped, setSwapped] = useState(false);
  const [shown, setShown] = useState(true);
  const [handshakeOpen, setHandshakeOpen] = useState(false);
  const both = localOn(call) && remoteOn(call);
  const live = call.phase === "active" || call.phase === "reconnecting";
  // Web: Esc folds the video call into the bar at the top.
  useEscape(call.phase !== "incoming" && call.phase !== "ended", () => setMinimized(true));
  // The controls hide only over the other side's video, in a call.
  const autoHide = remoteOn(call) && live && !handshakeOpen;

  useEffect(() => {
    getItem(LAYOUT_KEY)
      .then((saved) => {
        if (saved === "pip" || saved === "split") {
          setLayout(saved);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!autoHide || !shown) {
      return;
    }

    const timer = setTimeout(() => setShown(false), 4000);
    return () => clearTimeout(timer);
  }, [autoHide, shown]);

  const changeLayout = () => {
    const next = layout === "pip" ? "split" : "pip";
    setLayout(next);
    setItem(LAYOUT_KEY, next).catch(() => {});
  };

  const overlays = shown || !autoHide;

  return (
    <View
      style={[
        styles.videoScreen,
        wide ? [styles.videoCard, { borderColor: colors.line }] : styles.flex,
      ]}
    >
      <Stage call={call} layout={both ? layout : "pip"} swapped={both && swapped} onSwap={() => setSwapped((s) => !s)} onTap={() => setShown((s) => !s)} wide={wide} />

      {overlays ? (
        <>
          <View pointerEvents="box-none" style={[styles.videoTop, { paddingTop: (wide ? 0 : insets.top) + 12 }]}>
            <View style={styles.top}>
              {call.phase !== "incoming" ? (
                <OverlayButton icon="chevron-down" label="Minimize the call" onPress={() => setMinimized(true)} />
              ) : (
                <View style={styles.topSpacer} />
              )}
              <View style={[styles.secure, styles.videoPill]}>
                <Ionicons name="lock-closed" size={12} color="#ffffff" />
                <Text style={[styles.secureText, styles.videoText]}>End-to-end encrypted</Text>
              </View>
              {both ? (
                <OverlayButton
                  icon={layout === "pip" ? "grid-outline" : "albums-outline"}
                  label={layout === "pip" ? "Side by side" : "Picture in picture"}
                  onPress={changeLayout}
                />
              ) : (
                <View style={styles.topSpacer} />
              )}
            </View>
            <View pointerEvents="none" style={styles.videoTitle}>
              <Text numberOfLines={1} style={[styles.videoName, styles.videoText]}>
                @{call.chat.username}
              </Text>
              <Text style={[styles.videoStatus, styles.videoText]}>
                {call.phase === "incoming" ? "Incoming video call" : status}
              </Text>
            </View>
            <View pointerEvents="box-none" style={styles.videoChips}>
              <Chips call={call} overlay />
            </View>
          </View>

          <View pointerEvents="box-none" style={[styles.videoBottom, { paddingBottom: (wide ? 0 : insets.bottom) + 16 }]}>
            {call.handshake && live ? (
              <ScrollView style={styles.videoHandshake} contentContainerStyle={styles.videoHandshakeContent}>
                <Handshake
                  handshake={call.handshake}
                  username={call.chat.username ?? "…"}
                  onOpen={setHandshakeOpen}
                />
              </ScrollView>
            ) : null}
            <Controls call={call} overlay />
          </View>
        </>
      ) : null}
    </View>
  );
}

// The videos: the other side's big and this side's in a corner (it can be
// dragged to another corner; a tap swaps them), or both side by side.
function Stage({
  call,
  layout,
  swapped,
  onSwap,
  onTap,
  wide,
}: {
  call: CallView;
  layout: Layout;
  swapped: boolean;
  onSwap: () => void;
  onTap: () => void;
  wide: boolean;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const local = localOn(call) ? call.localVideo : null;
  const remote = remoteOn(call) ? call.remoteVideo : null;
  const mirror = call.facing === "user";

  const localTile = (fit: "cover" | "contain", onTop: boolean) =>
    local ? (
      <View style={styles.flex}>
        <CallVideo stream={local} mirror={mirror} fit={fit} onTop={onTop} style={styles.flex} />
        {call.canSwitchCamera ? <FlipButton /> : null}
      </View>
    ) : null;
  const remoteTile = (fit: "cover" | "contain", onTop: boolean) =>
    remote ? <CallVideo stream={remote} fit={fit} onTop={onTop} style={styles.flex} /> : null;

  // The big video fills phones, and fits in the window on computers.
  const bigFit = wide ? "contain" : "cover";

  let content: ReactNode;

  if (layout === "split" && local && remote) {
    const row = size.width > size.height;

    content = (
      <View style={[styles.flex, { flexDirection: row ? "row" : "column", gap: 2 }]}>
        <View style={styles.flex}>{remoteTile("cover", false)}</View>
        <View style={styles.flex}>{localTile("cover", false)}</View>
      </View>
    );
  } else {
    const bigIsLocal = !remote || swapped;

    content = (
      <>
        {bigIsLocal ? localTile("cover", false) : remoteTile(bigFit, false)}
        {local && remote ? (
          <Floating area={size} onTap={onSwap}>
            {bigIsLocal ? remoteTile("cover", true) : localTile("cover", true)}
          </Floating>
        ) : null}
      </>
    );
  }

  return (
    <Pressable
      onPress={onTap}
      accessible={false}
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      style={styles.stage}
    >
      {content}
    </Pressable>
  );
}

const FLOAT_MARGIN = 12;

// The small video, in a corner of `area`.
function Floating({ area, onTap, children }: { area: { width: number; height: number }; onTap: () => void; children: ReactNode }) {
  const [corner, setCorner] = useState({ right: true, bottom: false });
  const [drag] = useState(() => new Animated.ValueXY());
  const width = Math.min(Math.max(area.width * 0.28, 96), 200);
  const height = width * 1.4;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderMove: Animated.event([null, { dx: drag.x, dy: drag.y }], { useNativeDriver: false }),
        onPanResponderRelease: (_, gesture) => {
          drag.setValue({ x: 0, y: 0 });

          if (Math.abs(gesture.dx) < 6 && Math.abs(gesture.dy) < 6) {
            onTap();
            return;
          }

          // Where its middle was let go.
          setCorner((was) => {
            const x = (was.right ? area.width - FLOAT_MARGIN - width / 2 : FLOAT_MARGIN + width / 2) + gesture.dx;
            const y = (was.bottom ? area.height - FLOAT_MARGIN - height / 2 : FLOAT_MARGIN + height / 2) + gesture.dy;
            return { right: x > area.width / 2, bottom: y > area.height / 2 };
          });
        },
        onPanResponderTerminate: () => drag.setValue({ x: 0, y: 0 }),
      }),
    [area.width, area.height, width, height, drag, onTap],
  );

  return (
    <Animated.View
      {...responder.panHandlers}
      style={[
        styles.floating,
        {
          width,
          height,
          transform: drag.getTranslateTransform(),
          // Clear of the name at the top and the buttons at the bottom.
          ...(corner.right ? { right: FLOAT_MARGIN } : { left: FLOAT_MARGIN }),
          ...(corner.bottom ? { bottom: 200 } : { top: 140 }),
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

function FlipButton() {
  const { switchCamera } = useCalls();

  return (
    <Pressable
      onPress={switchCamera}
      accessibilityRole="button"
      accessibilityLabel="Switch camera"
      hitSlop={8}
      style={styles.flip}
    >
      <Ionicons name="camera-reverse-outline" size={20} color="#ffffff" />
    </Pressable>
  );
}

function OverlayButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.overlayButton, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Ionicons name={icon} size={20} color="#ffffff" />
    </Pressable>
  );
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

// The browser held the other side's audio back (Safari): a tap plays it.
function PlayAudio({ username }: { username: string }) {
  const { playAudio } = useCalls();
  const { colors } = useAppTheme();

  return (
    <Pressable
      onPress={playAudio}
      accessibilityRole="button"
      style={({ pressed }) => [styles.playAudio, { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 }]}
    >
      <Ionicons name="volume-high" size={18} color="#ffffff" />
      <Text style={styles.playAudioText}>Tap to hear @{username}</Text>
    </Pressable>
  );
}

// How loud each side is, and how the audio goes: shows whether the
// microphone works and why there is a delay.
function Quality({ username, muted }: { username: string; muted: boolean }) {
  const { stats: getStats } = useCalls();
  const { colors } = useAppTheme();
  const [stats, setStats] = useState<CallStats | null>(null);

  useEffect(() => {
    let stopped = false;

    const timer = setInterval(() => {
      getStats().then((next) => {
        if (!stopped) {
          setStats(next);
        }
      });
    }, 250);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [getStats]);

  if (!stats) {
    return null;
  }

  const route = [
    stats.route === "relay" ? "Through the Ostrich server" : stats.route === "direct" ? "Direct" : null,
    stats.protocol?.toUpperCase(),
    stats.roundTrip !== null ? `ping ${stats.roundTrip} ms` : null,
    stats.buffer !== null ? `buffer ${stats.buffer} ms` : null,
  ].filter(Boolean);

  return (
    <View style={styles.quality}>
      <View style={styles.meters}>
        {stats.micLevel !== null ? <Meter label="You" level={muted ? 0 : stats.micLevel} /> : null}
        {stats.peerLevel !== null ? <Meter label={`@${username}`} level={stats.peerLevel} /> : null}
      </View>
      {route.length > 0 ? <Text style={[styles.route, { color: colors.muted }]}>{route.join(" · ")}</Text> : null}
    </View>
  );
}

const METER_BARS = 5;

function Meter({ label, level }: { label: string; level: number }) {
  const { colors } = useAppTheme();
  // From -60 dB (silence) to -10 dB (loud speech).
  const db = 20 * Math.log10(Math.max(level, 1e-6));
  const lit = Math.round(Math.min(Math.max((db + 60) / 50, 0), 1) * METER_BARS);

  return (
    <View style={styles.meter} accessibilityLabel={`${label}: ${lit > 0 ? "sound" : "silence"}`}>
      <Text numberOfLines={1} style={[styles.meterLabel, { color: colors.muted }]}>
        {label}
      </Text>
      <View style={styles.meterBars}>
        {Array.from({ length: METER_BARS }, (_, i) => (
          <View
            key={i}
            style={[
              styles.meterBar,
              { height: 6 + i * 3, backgroundColor: i < lit ? colors.online : colors.line },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function Controls({ call, overlay = false }: { call: CallView; overlay?: boolean }) {
  const { accept, decline, hangUp, toggleMute, toggleSpeaker, toggleCamera } = useCalls();
  const { colors } = useAppTheme();
  // Over video: see-through buttons, white.
  const plain = overlay ? "rgba(255, 255, 255, 0.2)" : colors.panelAlt;
  const plainIcon = overlay ? "#ffffff" : colors.text;
  const onIcon = overlay ? "#111111" : colors.surface;
  const onBackground = overlay ? "#ffffff" : colors.text;
  const labelColor = overlay ? "#ffffff" : undefined;

  if (call.phase === "ended") {
    return <View style={styles.controls} />;
  }

  if (call.phase === "incoming") {
    return (
      <View style={styles.controls}>
        <RoundButton icon="close" label="Decline" color="#ffffff" background={colors.danger} labelColor={labelColor} onPress={decline} />
        {call.video ? (
          <>
            <RoundButton
              icon="call"
              label="Audio only"
              color={plainIcon}
              background={plain}
              labelColor={labelColor}
              onPress={() => accept(false)}
            />
            <RoundButton
              icon="videocam"
              label="Video"
              color="#08240f"
              background={colors.online}
              labelColor={labelColor}
              onPress={() => accept(true)}
            />
          </>
        ) : (
          <RoundButton icon="call" label="Answer" color="#08240f" background={colors.online} labelColor={labelColor} onPress={() => accept(false)} />
        )}
      </View>
    );
  }

  return (
    <View style={styles.controls}>
      <RoundButton
        icon={call.muted ? "mic-off" : "mic"}
        label={call.muted ? "Unmute" : "Mute"}
        color={call.muted ? onIcon : plainIcon}
        background={call.muted ? onBackground : plain}
        labelColor={labelColor}
        onPress={toggleMute}
      />
      <RoundButton
        icon={call.camera ? "videocam" : "videocam-off-outline"}
        label="Camera"
        color={call.camera ? onIcon : plainIcon}
        background={call.camera ? onBackground : plain}
        labelColor={labelColor}
        onPress={toggleCamera}
      />
      {callSounds.canUseSpeaker ? (
        <RoundButton
          icon={call.speaker ? "volume-high" : "volume-medium-outline"}
          label="Speaker"
          color={call.speaker ? onIcon : plainIcon}
          background={call.speaker ? onBackground : plain}
          labelColor={labelColor}
          onPress={toggleSpeaker}
        />
      ) : null}
      <RoundButton icon="call" label="Hang up" color="#ffffff" background={colors.danger} labelColor={labelColor} onPress={hangUp} rotate />
    </View>
  );
}

function RoundButton({
  icon,
  label,
  color,
  background,
  onPress,
  labelColor,
  rotate = false,
}: {
  icon: IconName;
  label: string;
  color: string;
  background: string;
  onPress: () => void;
  labelColor?: string;
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
      <Text style={[styles.roundLabel, { color: labelColor ?? colors.muted }]}>{label}</Text>
    </View>
  );
}

// --- the Ostrich handshake (lib/handshake.ts) ---

function Handshake({
  handshake,
  username,
  onOpen,
}: {
  handshake: HandshakeView;
  username: string;
  // Opened or closed (the video screen keeps its buttons meanwhile).
  onOpen?: (open: boolean) => void;
}) {
  const { pickPhrase } = useCalls();
  const { colors } = useAppTheme();
  const [open, setOpenState] = useState(false);

  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpen?.(next);
  };

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

  playAudio: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },

  playAudioText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },

  quality: {
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },

  meters: {
    flexDirection: "row",
    gap: 24,
  },

  meter: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    maxWidth: 160,
  },

  meterLabel: {
    flexShrink: 1,
    fontSize: 12,
  },

  meterBars: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
  },

  meterBar: {
    width: 4,
    borderRadius: 2,
  },

  route: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },

  videoScreen: {
    backgroundColor: "#000000",
    overflow: "hidden",
  },

  videoCard: {
    width: "100%",
    maxWidth: 1000,
    height: "100%",
    maxHeight: 760,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
  },

  stage: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },

  videoTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
    backgroundColor: "rgba(0, 0, 0, 0.25)",
  },

  videoBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: "rgba(0, 0, 0, 0.25)",
  },

  videoPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
  },

  videoText: {
    color: "#ffffff",
    textShadowColor: "rgba(0, 0, 0, 0.6)",
    textShadowRadius: 4,
  },

  videoTitle: {
    alignItems: "center",
  },

  videoName: {
    fontSize: 20,
    fontWeight: "700",
  },

  videoStatus: {
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },

  videoChips: {
    alignItems: "center",
    gap: 6,
  },

  videoHandshake: {
    maxHeight: 340,
    marginBottom: 4,
  },

  videoHandshakeContent: {
    paddingBottom: 4,
  },

  overlayButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.35)",
  },

  floating: {
    position: "absolute",
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#222222",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.35)",
  },

  flip: {
    position: "absolute",
    top: 8,
    left: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },

  controls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
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

  // Where the card animates: all of the backdrop, the card sized in it.
  cardPlace: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },

  fromTop: {
    transformOrigin: "50% 0%",
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
