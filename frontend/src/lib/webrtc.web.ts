import type { PeerLike, StreamLike } from "./call-connection";

// The browser's WebRTC, and call sounds made with Web Audio (no files to
// load). The apps' is lib/webrtc.ts.

// Call sounds, the microphone's meter, Safari's unlocking.
let context: AudioContext | null = null;

// Plays the other side's audio; one call at a time. An element in the
// page, started once by a click (unlockAudio): Safari plays later sound
// only through an element started that way.
let remoteAudio: HTMLAudioElement | null = null;
// The microphone's loudness, for the call screen.
let micMeter: { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; samples: Float32Array<ArrayBuffer> } | null =
  null;

function audioElement() {
  if (!remoteAudio) {
    remoteAudio = document.createElement("audio");
    remoteAudio.autoplay = true;
    remoteAudio.setAttribute("playsinline", "");
    remoteAudio.style.display = "none";
    document.body.appendChild(remoteAudio);
  }

  return remoteAudio;
}

function audioContext() {
  try {
    context ??= new AudioContext();
  } catch {
    return null;
  }

  return context;
}

export const webrtc = {
  createPeer: (config: object) => new RTCPeerConnection(config as RTCConfiguration) as unknown as PeerLike,

  getMicrophone: async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });

    const audio = audioContext();

    if (audio) {
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      const source = audio.createMediaStreamSource(stream);
      source.connect(analyser);
      micMeter?.source.disconnect();
      micMeter = { analyser, source, samples: new Float32Array(analyser.fftSize) };
    }

    return stream as unknown as StreamLike;
  },

  // In the click that calls or answers: lets the page play the call later.
  unlockAudio: () => {
    const audio = audioContext();
    audio?.resume().catch(() => {});

    const element = audioElement();

    if (!element.srcObject && audio) {
      // Something silent to start the element with.
      element.srcObject = audio.createMediaStreamDestination().stream;
    }

    element.play().catch(() => {});
  },

  // False when the browser did not let it play (a tap on the call screen
  // starts it: playRemote again).
  playRemote: async (stream: StreamLike | null) => {
    if (!stream) {
      if (remoteAudio) {
        remoteAudio.srcObject = null;
      }

      micMeter?.source.disconnect();
      micMeter = null;
      return true;
    }

    const element = audioElement();

    if (element.srcObject !== (stream as unknown as MediaStream)) {
      element.srcObject = stream as unknown as MediaStream;
    }

    context?.resume().catch(() => {});

    try {
      await element.play();
      return true;
    } catch {
      return false;
    }
  },

  // 0…1, or null when unknown.
  micLevel: () => {
    if (!micMeter) {
      return null;
    }

    micMeter.analyser.getFloatTimeDomainData(micMeter.samples);
    let sum = 0;

    for (const sample of micMeter.samples) {
      sum += sample * sample;
    }

    return Math.sqrt(sum / micMeter.samples.length);
  },
};

// --- sounds ---

let tone: { stop: () => void } | null = null;

// Beeps of `frequencies` (played together) for `on` ms every `every` ms.
function repeatTone(frequencies: number[], on: number[], every: number, volume: number) {
  stopTone();

  const audio = audioContext();

  if (!audio) {
    return;
  }

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
