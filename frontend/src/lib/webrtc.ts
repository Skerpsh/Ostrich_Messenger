import InCallManager from "react-native-incall-manager";
import { mediaDevices, RTCPeerConnection } from "react-native-webrtc";
import type { PeerLike, StreamLike } from "./call-connection";

// The apps' WebRTC (react-native-webrtc, in development and store builds,
// not in Expo Go) and call sounds (react-native-incall-manager: the system
// ringtone, the ringback tone, earpiece or speaker, the proximity sensor).
// The web's is lib/webrtc.web.ts.

export const webrtc = {
  createPeer: (config: object) => new RTCPeerConnection(config) as unknown as PeerLike,

  getMicrophone: () => mediaDevices.getUserMedia({ audio: true, video: false }) as unknown as Promise<StreamLike>,

  // The apps play the other side's audio on their own.
  playRemote: (_stream: StreamLike | null) => {},
};

// Whether InCallManager runs (start() routes the audio for a call).
let started = false;

export const callSounds = {
  // Phones can switch between the earpiece and the speaker.
  canUseSpeaker: true,

  // An incoming call: the system ringtone (and vibration).
  ringing() {
    InCallManager.startRingtone("_DEFAULT_", [0, 800, 1200], "playback", 45);
  },

  // Calling out: the call's audio and the ringback tone until answered.
  calling() {
    InCallManager.start({ media: "audio", ringback: "_DTMF_" });
    started = true;
  },

  // Answered (on either side): only the call's audio.
  connected() {
    InCallManager.stopRingtone();
    InCallManager.stopRingback();

    if (!started) {
      InCallManager.start({ media: "audio" });
      started = true;
    }
  },

  speaker(on: boolean) {
    InCallManager.setForceSpeakerphoneOn(on);
  },

  stop() {
    InCallManager.stopRingtone();
    InCallManager.stopRingback();

    if (started) {
      InCallManager.stop();
      started = false;
    }
  },
};
