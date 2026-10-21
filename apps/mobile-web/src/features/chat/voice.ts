import { Platform } from "react-native";
import { RecordingPresets, type RecordingOptions } from "expo-audio";
import { fromBase64, toBase64 } from "@/crypto/crypto";

// Voice messages: recorded with expo-audio (MediaRecorder on the web),
// sent as an encrypted audio attachment that also carries its length and
// a waveform (payload.ts), drawn as bars in the bubble.

export const VOICE_MAX_MS = 10 * 60_000;
// Shorter is a tap by mistake.
export const VOICE_MIN_MS = 700;
export const WAVEFORM_BARS = 48;
// How often the loudness is sampled while recording.
export const METERING_INTERVAL_MS = 100;

// What the web can record: AAC in MP4 plays everywhere (iOS cannot play
// WebM), so it comes first where the browser supports it.
const WEB_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

function webType() {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  return WEB_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

// Mono AAC at 64 kbit/s: about half a megabyte a minute.
export const VOICE_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64_000,
  isMeteringEnabled: true,
  web: { mimeType: Platform.OS === "web" ? webType() : undefined, bitsPerSecond: 64_000 },
};

// The type and file name of a recording.
export function voiceFile(mime: string) {
  const type = mime.split(";")[0] || "audio/mp4";
  const extension = type === "audio/webm" ? "webm" : type === "audio/ogg" ? "ogg" : "m4a";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");

  return { mime: type === "audio/x-m4a" ? "audio/mp4" : type, name: `voice-${stamp}.${extension}` };
}

// Loudness in dBFS (as metered, -160 = silence) → 0–1.
export function level(db: number | undefined) {
  if (db === undefined || !Number.isFinite(db)) {
    return 0;
  }

  return Math.min(1, Math.max(0, (db + 50) / 50));
}

// The levels sampled while recording, as WAVEFORM_BARS bars scaled to the
// loudest, in base64 (one byte each).
export function encodeWaveform(levels: number[]) {
  const bars = new Uint8Array(WAVEFORM_BARS);

  if (levels.length === 0) {
    return toBase64(bars);
  }

  for (let i = 0; i < WAVEFORM_BARS; i++) {
    const from = Math.floor((i * levels.length) / WAVEFORM_BARS);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / WAVEFORM_BARS));
    let peak = 0;

    for (let j = from; j < to && j < levels.length; j++) {
      peak = Math.max(peak, levels[j]);
    }

    bars[i] = Math.round(peak * 255);
  }

  const loudest = Math.max(...bars) || 1;

  return toBase64(bars.map((bar) => Math.round((bar / loudest) * 255)));
}

// The bars of a received waveform, 0–1 each; flat if it has none.
export function decodeWaveform(waveform: string | undefined): number[] {
  if (waveform) {
    try {
      const bytes = fromBase64(waveform);

      if (bytes.length > 0) {
        return Array.from(bytes.slice(0, 128), (byte) => byte / 255);
      }
    } catch {}
  }

  return Array.from({ length: WAVEFORM_BARS }, () => 0.3);
}
