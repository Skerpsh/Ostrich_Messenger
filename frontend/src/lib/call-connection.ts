import { fingerprintOf } from "./handshake";
import { webrtc } from "./webrtc";

// The audio connection of a call (WebRTC), the same on the web (the
// browser's WebRTC) and in the apps (react-native-webrtc): lib/webrtc.ts
// gives the platform's parts. The devices talk directly, or through the
// TURN server when they cannot; either way the audio is encrypted between
// them (DTLS-SRTP) with certificates whose fingerprints the encrypted
// offer and answer carry (lib/crypto.ts).

export type IceServer = { urls: string[]; username?: string; credential?: string };

export type Candidate = { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };

export type LinkState = "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";

// What both platforms' WebRTC have in common, as far as calls use it.
export type TrackLike = { enabled: boolean; stop: () => void };
export type StreamLike = { getTracks: () => TrackLike[] };
type DescriptionLike = { type: string; sdp?: string };
export type PeerLike = {
  localDescription: DescriptionLike | null;
  remoteDescription: DescriptionLike | null;
  connectionState?: string;
  iceConnectionState: string;
  createOffer: (options?: { iceRestart?: boolean }) => Promise<DescriptionLike>;
  createAnswer: () => Promise<DescriptionLike>;
  setLocalDescription: (description: DescriptionLike) => Promise<void>;
  setRemoteDescription: (description: DescriptionLike) => Promise<void>;
  addIceCandidate: (candidate: Candidate) => Promise<void>;
  addTrack: (track: TrackLike, stream: StreamLike) => unknown;
  addEventListener: (type: string, listener: (event: never) => void) => void;
  close: () => void;
};

type Handlers = {
  // A network address of this device, for the other side.
  onCandidate: (candidate: Candidate) => void;
  onState: (state: LinkState) => void;
};

// Older browsers have only the ICE state.
function linkState(peer: PeerLike): LinkState {
  if (peer.connectionState) {
    return peer.connectionState as LinkState;
  }

  switch (peer.iceConnectionState) {
    case "checking":
      return "connecting";
    case "completed":
      return "connected";
    default:
      return peer.iceConnectionState as LinkState;
  }
}

export class CallConnection {
  // The other side's addresses that came before its description.
  private early: Candidate[] = [];
  private closed = false;

  private constructor(
    private peer: PeerLike,
    private microphone: StreamLike,
  ) {}

  // Opens the microphone (asking for it if needed; throws if refused).
  static async open(iceServers: IceServer[], handlers: Handlers) {
    const microphone = await webrtc.getMicrophone();
    const peer = webrtc.createPeer({ iceServers, bundlePolicy: "max-bundle" });
    const connection = new CallConnection(peer, microphone);

    for (const track of microphone.getTracks()) {
      peer.addTrack(track, microphone);
    }

    peer.addEventListener("icecandidate", (event: { candidate: Candidate | null }) => {
      const { candidate } = event;

      if (candidate?.candidate && !connection.closed) {
        handlers.onCandidate({
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        });
      }
    });

    peer.addEventListener("track", (event: { streams: StreamLike[] }) => {
      webrtc.playRemote(event.streams[0] ?? null);
    });

    const onState = () => {
      if (!connection.closed) {
        handlers.onState(linkState(peer));
      }
    };

    peer.addEventListener("connectionstatechange", onState);
    peer.addEventListener("iceconnectionstatechange", onState);

    return connection;
  }

  // The caller: a new offer (again with new addresses after a network
  // change: iceRestart), set as this side's description.
  async offer(iceRestart = false) {
    const offer = await this.peer.createOffer(iceRestart ? { iceRestart } : undefined);
    await this.peer.setLocalDescription(offer);

    return this.peer.localDescription?.sdp ?? offer.sdp ?? "";
  }

  // The callee: the answer to the caller's offer.
  async answer(offerSdp: string) {
    await this.setRemote({ type: "offer", sdp: offerSdp });

    const answer = await this.peer.createAnswer();
    await this.peer.setLocalDescription(answer);

    return this.peer.localDescription?.sdp ?? answer.sdp ?? "";
  }

  // The caller: the callee's answer.
  async accept(answerSdp: string) {
    await this.setRemote({ type: "answer", sdp: answerSdp });
  }

  private async setRemote(description: DescriptionLike) {
    await this.peer.setRemoteDescription(description);

    const early = this.early;
    this.early = [];

    for (const candidate of early) {
      await this.addCandidate(candidate);
    }
  }

  async addCandidate(candidate: Candidate) {
    if (!this.peer.remoteDescription) {
      this.early.push(candidate);
      return;
    }

    // One bad address must not end the call.
    await this.peer.addIceCandidate(candidate).catch(() => {});
  }

  // The certificate fingerprints of this side and of the other, from the
  // descriptions in use (lib/handshake.ts).
  fingerprints() {
    return {
      local: fingerprintOf(this.peer.localDescription?.sdp ?? ""),
      remote: fingerprintOf(this.peer.remoteDescription?.sdp ?? ""),
    };
  }

  setMuted(muted: boolean) {
    for (const track of this.microphone.getTracks()) {
      track.enabled = !muted;
    }
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;

    for (const track of this.microphone.getTracks()) {
      track.stop();
    }

    this.peer.close();
    webrtc.playRemote(null);
  }
}
