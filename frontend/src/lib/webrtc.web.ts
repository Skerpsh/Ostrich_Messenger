import type { PeerLike, StreamLike } from "./call-connection";

// The browser's WebRTC, and call sounds made with Web Audio (no files to
// load). The apps' is lib/webrtc.ts.

// Plays the other side's audio; one call at a time.
let remoteAudio: HTMLAudioElement | null = null;

export const webrtc = {
  createPeer: (config: object) => new RTCPeerConnection(config as RTCConfiguration) as unknown as PeerLike,

  getMicrophone: () =>
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    }) as unknown as Promise<StreamLike>,

  playRemote: (stream: StreamLike | null) => {
    if (!stream) {
      if (remoteAudio) {
        remoteAudio.srcObject = null;
        remoteAudio = null;
      }
      return;
    }

    remoteAudio ??= new Audio();
    remoteAudio.autoplay = true;
    remoteAudio.srcObject = stream as unknown as MediaStream;
    // Started by a click (call or answer), so the browser allows it.
    remoteAudio.play().catch(() => {});
  },
};

// --- sounds ---

let context: AudioContext | null = null;
let tone: { stop: () => void } | null = null;

// Beeps of `frequencies` (played together) for `on` ms every `every` ms.
function repeatTone(frequencies: number[], on: number[], every: number, volume: number) {
  stopTone();

  try {
    context ??= new AudioContext();
  } catch {
    return;
  }

  const audio = context;
  // A ringtone before any click on the page may stay silent: browsers
  // start audio only after the user has interacted with it.
  audio.resume().catch(() => {});

  const gain = audio.createGain();
  gain.gain.value = 0;
  gain.connect(audio.destination);

  const oscillators = frequencies.map((frequency) => {
    const oscillator = audio.createOscillator();
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start();
    return oscillator;
  });

  // Each beep: [start, length] in ms within the period.
  const schedule = () => {
    const now = audio.currentTime;

    for (let i = 0; i < on.length; i += 2) {
      const start = now + on[i] / 1000;
      const end = start + on[i + 1] / 1000;
      gain.gain.setTargetAtTime(volume, start, 0.01);
      gain.gain.setTargetAtTime(0, end, 0.02);
    }
  };

  schedule();
  const timer = setInterval(schedule, every);

  tone = {
    stop: () => {
      clearInterval(timer);
      gain.gain.cancelScheduledValues(audio.currentTime);
      gain.gain.value = 0;

      for (const oscillator of oscillators) {
        oscillator.stop();
        oscillator.disconnect();
      }

      gain.disconnect();
    },
  };
}

function stopTone() {
  tone?.stop();
  tone = null;
}

export const callSounds = {
  canUseSpeaker: false,

  // Two short chirps every two seconds.
  ringing() {
    repeatTone([659, 880], [0, 180, 280, 180], 2000, 0.12);
  },

  // The ringback tone: 425 Hz, a second on, four off.
  calling() {
    repeatTone([425], [0, 1000], 5000, 0.08);
  },

  connected() {
    stopTone();
  },

  speaker(_on: boolean) {},

  stop() {
    stopTone();
  },
};
