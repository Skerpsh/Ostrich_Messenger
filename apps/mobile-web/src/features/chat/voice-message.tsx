import { useEffect, useMemo, useRef, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from "expo-audio";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Swap } from "@/ui/reveal";
import { useAuth } from "@/features/auth/auth";
import { useAppTheme } from "@/ui/theme";
import { formatDuration, loadAttachment } from "./attachments";
import { playableSource } from "@/platform/files";
import type { Attachment } from "./payload";
import { decodeWaveform } from "./voice";

// One voice message plays at a time: starting one pauses the other.
let current: AudioPlayer | null = null;

const SPEEDS = [1, 1.5, 2];

// A voice message in a bubble: play / pause, its waveform (tap it to jump
// there), the time, the speed. The file is downloaded on the first play.
export default function VoiceMessage({
  attachment,
  own,
  onError,
}: {
  attachment: Attachment;
  own: boolean;
  onError: (message: string) => void;
}) {
  const { colors } = useAppTheme();
  const { withToken } = useAuth();
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [width, setWidth] = useState(0);
  const release = useRef<(() => void) | null>(null);

  const bars = useMemo(() => decodeWaveform(attachment.waveform), [attachment.waveform]);
  const total = (attachment.duration ?? 0) / 1000 || status.duration || 0;
  const progress = total > 0 ? Math.min(1, status.currentTime / total) : 0;
  const fg = own ? colors.onAccent : colors.accent;
  const dim = own ? "rgba(255, 255, 255, 0.45)" : colors.line;

  useEffect(
    () => () => {
      if (current === player) {
        current = null;
      }

      release.current?.();
    },
    [player],
  );

  // Back to the start when it ends.
  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      player.seekTo(0);
    }
  }, [status.didJustFinish, player]);

  const load = async () => {
    const bytes = await withToken((token) => loadAttachment(token, attachment));
    const source = playableSource(bytes, attachment.id, attachment.mime);
    release.current?.();
    release.current = source.release;
    player.replace({ uri: source.uri });
    player.setPlaybackRate(speed);
    setLoaded(true);
  };

  const toggle = async () => {
    if (status.playing) {
      player.pause();
      return;
    }

    if (!loaded) {
      setLoading(true);

      try {
        await load();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Failed to load the voice message");
        return;
      } finally {
        setLoading(false);
      }
    }

    if (current && current !== player) {
      current.pause();
    }

    current = player;
    player.play();
  };

  const seek = async (x: number) => {
    if (!loaded || width <= 0 || total <= 0) {
      return;
    }

    await player.seekTo(Math.max(0, Math.min(1, x / width)) * total);
  };

  const changeSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    player.setPlaybackRate(next);
  };

  const started = loaded && (status.playing || status.currentTime > 0);

  return (
    <View style={styles.voice}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? "Pause the voice message" : "Play the voice message"}
        style={[styles.play, { backgroundColor: fg }]}
      >
        <Swap id={loading ? "loading" : status.playing ? "pause" : "play"} resize={false}>
          {loading ? (
            <ActivityIndicator size="small" color={own ? colors.accent : colors.onAccent} />
          ) : (
            <Ionicons
              name={status.playing ? "pause" : "play"}
              size={20}
              color={own ? colors.accent : colors.onAccent}
              style={status.playing ? undefined : styles.playIcon}
            />
          )}
        </Swap>
      </Pressable>
      <View style={styles.body}>
        <Pressable
          onPress={(event) => seek(event.nativeEvent.locationX)}
          onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
          accessibilityLabel="Waveform"
          style={styles.bars}
        >
          {bars.map((bar, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height: 3 + bar * 19,
                  backgroundColor: started && (i + 0.5) / bars.length <= progress ? fg : dim,
                },
              ]}
            />
          ))}
        </Pressable>
        <View style={styles.meta}>
          <Text style={[styles.time, { color: own ? colors.onAccent : colors.muted }]}>
            {started ? formatDuration(status.currentTime * 1000) : formatDuration(total * 1000)}
          </Text>
          {started ? (
            <Pressable
              onPress={changeSpeed}
              accessibilityRole="button"
              accessibilityLabel={`Speed ${speed}×`}
              style={[styles.speed, { backgroundColor: own ? "rgba(0, 0, 0, 0.15)" : colors.panelAlt }]}
            >
              <Text style={[styles.speedText, { color: own ? colors.onAccent : colors.textSoft }]}>{speed}×</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// The bars of a waveform being recorded (the newest on the right).
export function LiveWaveform({ levels, color }: { levels: number[]; color: string }) {
  return (
    <View style={styles.live}>
      {levels.map((value, i) => (
        <View key={i} style={[styles.liveBar, { height: 3 + value * 21, backgroundColor: color }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  voice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 220,
    paddingVertical: 2,
  },

  play: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },

  // The triangle looks off-center otherwise.
  playIcon: {
    marginLeft: 3,
  },

  body: {
    flex: 1,
    gap: 3,
  },

  bars: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 24,
  },

  bar: {
    flex: 1,
    maxWidth: 3,
    borderRadius: 1.5,
    pointerEvents: "none",
  },

  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  time: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },

  speed: {
    paddingHorizontal: 5,
    borderRadius: 6,
  },

  speedText: {
    fontSize: 11,
    fontWeight: "700",
  },

  live: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
    height: 26,
    overflow: "hidden",
  },

  liveBar: {
    width: 3,
    borderRadius: 1.5,
  },
});
