import { useEffect, useRef, useState } from "react";
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { Platform, StyleSheet, Text, View } from "react-native";
import IconButton from "@/components/icon-button";
import { LiveWaveform } from "@/components/voice-message";
import { useAppTheme } from "@/context/theme";
import { formatDuration, type PickedFile } from "@/lib/attachments";
import { readUri, removeUri } from "@/lib/files";
import {
  encodeWaveform,
  level,
  METERING_INTERVAL_MS,
  VOICE_MAX_MS,
  VOICE_MIN_MS,
  VOICE_RECORDING,
  voiceFile,
} from "@/lib/voice";

// Bars shown while recording.
const LIVE_BARS = 40;

export type VoiceRecorder = ReturnType<typeof useVoiceRecorder>;

// Recording a voice message: start() asks for the microphone and records;
// finish() hands the recording to onDone as a file to send, cancel()
// throws it away.
export function useVoiceRecorder({
  onDone,
  onError,
}: {
  onDone: (file: PickedFile) => void;
  onError: (message: string) => void;
}) {
  const recorder = useAudioRecorder(VOICE_RECORDING);
  const state = useAudioRecorderState(recorder, METERING_INTERVAL_MS);
  const [active, setActive] = useState(false);
  const levels = useRef<number[]>([]);
  const [live, setLive] = useState<number[]>([]);
  const busy = useRef(false);

  const metering = state.metering;
  const recording = active && state.isRecording;

  // Every sample of the loudness, for the waveform.
  useEffect(() => {
    if (!recording) {
      return;
    }

    levels.current.push(level(metering));
    setLive(levels.current.slice(-LIVE_BARS));
  }, [recording, metering, state.durationMillis]);

  const stop = async () => {
    try {
      await recorder.stop();
    } catch {
      // Not recording after all.
    }

    setActive(false);

    if (Platform.OS === "ios") {
      // Back to the speaker for playing.
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    }
  };

  const start = async () => {
    if (busy.current || active) {
      return;
    }

    busy.current = true;

    try {
      const permission = await requestRecordingPermissionsAsync();

      if (!permission.granted) {
        onError(
          Platform.OS === "web"
            ? "Allow the microphone for this site in the browser to record voice messages"
            : "Allow the microphone in the settings to record voice messages",
        );
        return;
      }

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      levels.current = [];
      setLive([]);
      recorder.record();
      setActive(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to start recording");
      await stop();
    } finally {
      busy.current = false;
    }
  };

  const finish = async () => {
    if (busy.current || !active) {
      return;
    }

    busy.current = true;
    const duration = Math.min(VOICE_MAX_MS, recorder.getStatus().durationMillis || state.durationMillis);

    try {
      await stop();
      const uri = recorder.uri;

      if (!uri || duration < VOICE_MIN_MS) {
        return;
      }

      let type = "audio/mp4";

      if (Platform.OS === "web") {
        type = (await (await fetch(uri)).blob()).type || "audio/webm";
      }

      const bytes = await readUri(uri);
      // The recording is not encrypted: it does not stay on the device.
      removeUri(uri);
      const { mime, name } = voiceFile(type);

      onDone({ bytes, mime, name, duration, waveform: encodeWaveform(levels.current) });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to record the voice message");
    } finally {
      busy.current = false;
    }
  };

  const cancel = async () => {
    if (!active) {
      return;
    }

    await stop();
    levels.current = [];
    setLive([]);

    if (recorder.uri) {
      removeUri(recorder.uri);
    }
  };

  // Reaching the longest a voice message can be sends it.
  const tooLong = recording && state.durationMillis >= VOICE_MAX_MS;
  const finishRef = useRef(finish);

  useEffect(() => {
    finishRef.current = finish;
  });

  useEffect(() => {
    if (tooLong) {
      finishRef.current();
    }
  }, [tooLong]);

  // Leaving the chat while recording stops the microphone.
  const cleanup = useRef(cancel);

  useEffect(() => {
    cleanup.current = cancel;
  });

  useEffect(() => () => void cleanup.current(), []);

  return { active, durationMillis: state.durationMillis, levels: live, start, finish, cancel };
}

// Shown in place of the message field while recording.
export function RecordingBar({ voice }: { voice: VoiceRecorder }) {
  const { colors } = useAppTheme();

  return (
    <View style={[styles.bar, { backgroundColor: colors.panelAlt }]}>
      <IconButton icon="trash-outline" label="Cancel the recording" size={20} color={colors.danger} onPress={voice.cancel} />
      <View style={[styles.dot, { backgroundColor: colors.danger }]} />
      <Text style={[styles.time, { color: colors.text }]}>{formatDuration(voice.durationMillis)}</Text>
      <LiveWaveform levels={voice.levels} color={colors.accent} />
    </View>
  );
}

// The microphone button where the send button is when there is nothing
// to send.
export function RecordButton({ voice, disabled }: { voice: VoiceRecorder; disabled?: boolean }) {
  return (
    <IconButton icon="mic" label="Record a voice message" filled size={22} onPress={voice.start} disabled={disabled} />
  );
}

const styles = StyleSheet.create({
  bar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 40,
    paddingRight: 12,
    borderRadius: 20,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  time: {
    fontSize: 15,
    fontVariant: ["tabular-nums"],
    minWidth: 40,
  },
});
