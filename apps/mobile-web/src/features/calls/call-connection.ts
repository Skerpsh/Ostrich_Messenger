import { fingerprintOf } from "./handshake";
import { webrtc } from "./webrtc";

// The audio connection of a call (WebRTC), the same on the web (the
// browser's WebRTC) and in the apps (react-native-webrtc): features/calls/webrtc.ts
// gives the platform's parts. The devices talk directly, or through the
// TURN server when they cannot; either way the audio is encrypted between
// them (DTLS-SRTP) with certificates whose fingerprints the encrypted
// offer and answer carry (crypto/crypto.ts). Every call has a video line
// from the start, so a camera turned on or off later only changes what
// it sends (no new offer).

export type IceServer = { urls: string[]; username?: string; credential?: string };

export type Candidate = { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };

export type LinkState = "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";

// What both platforms' WebRTC have in common, as far as calls use it.
export type TrackLike = { kind?: string; enabled: boolean; stop: () => void };
// toURL: the apps' streams, for showing them (RTCView).
export type StreamLike = { getTracks: () => TrackLike[]; toURL?: () => string };
type TransceiverLike = {
  direction: string;
  sender: { replaceTrack: (track: TrackLike | null) => Promise<void> };
  receiver: { track: TrackLike | null };
};
export type Facing = "user" | "environment";
type StatsLike = { forEach: (each: (stat: Record<string, unknown>) => void) => void };
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
  addTransceiver: (kind: "video", init: { direction: string; streams: StreamLike[] }) => TransceiverLike;
  getTransceivers: () => TransceiverLike[];
  addEventListener: (type: string, listener: (event: never) => void) => void;
  getStats: () => Promise<StatsLike>;
  close: () => void;
};

// How the call's audio goes, for the call screen; null: not known (yet,
// or on this browser).
export type CallStats = {
  // Straight between the devices, or through the TURN server.
  route: "direct" | "relay" | null;
  // To the other device, or to the TURN server when relayed.
  protocol: "udp" | "tcp" | null;
  // There and back, in ms.
  roundTrip: number | null;
  // How long received audio waits before it plays, in ms.
  buffer: number | null;
  // Loudness, 0…1.
  micLevel: number | null;
  peerLevel: number | null;
};

type Handlers = {
  // A network address of this device, for the other side.
  onCandidate: (candidate: Candidate) => void;
  onState: (state: LinkState) => void;
  // The browser did not let the other side's audio play (Safari): a tap
  // on the call screen starts it (playAgain).
  onPlayback: (playing: boolean) => void;
  // The other side's video (shown only while it says its camera is on).
  onRemoteVideo: (stream: StreamLike) => void;
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
  private remote: StreamLike | null = null;
  // The video line, and the camera it sends (none: nothing is sent).
  private video: TransceiverLike | null = null;
  private camera: TrackLike | null = null;
  // The last received audio energy, for its loudness when the browser
  // does not give it.
  private energy: { total: number; duration: number } | null = null;

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

    peer.addEventListener("track", (event: { track: TrackLike; streams: StreamLike[] }) => {
      if (event.track.kind === "video") {
        handlers.onRemoteVideo(event.streams[0] ?? webrtc.streamOf(event.track));
        return;
      }

      connection.remote = event.streams[0] ?? null;
      connection.playAgain(handlers.onPlayback);
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
    if (!this.video) {
      this.video = this.peer.addTransceiver("video", { direction: "sendrecv", streams: [this.microphone] });
      await this.video.sender.replaceTrack(this.camera);
    }

    const offer = await this.peer.createOffer(iceRestart ? { iceRestart } : undefined);
    await this.peer.setLocalDescription(offer);

    return this.peer.localDescription?.sdp ?? offer.sdp ?? "";
  }

  // The callee: the answer to the caller's offer.
  async answer(offerSdp: string) {
    await this.setRemote({ type: "offer", sdp: offerSdp });

    // The caller's video line, to send this side's camera on too (none:
    // an older app without video).
    if (!this.video) {
      this.video = this.peer.getTransceivers().find((t) => t.receiver.track?.kind === "video") ?? null;

      if (this.video) {
        this.video.direction = "sendrecv";
        await this.video.sender.replaceTrack(this.camera);
      }
    }

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
  // descriptions in use (features/calls/handshake.ts).
  fingerprints() {
    return {
      local: fingerprintOf(this.peer.localDescription?.sdp ?? ""),
      remote: fingerprintOf(this.peer.remoteDescription?.sdp ?? ""),
    };
  }

  // Plays the other side's audio (again: in a tap, after the browser did
  // not let it).
  playAgain(onPlayback: (playing: boolean) => void) {
    if (!this.remote) {
      return;
    }

    webrtc.playRemote(this.remote).then((playing) => {
      if (!this.closed) {
        onPlayback(playing);
      }
    });
  }

  async stats(): Promise<CallStats> {
    const stats: CallStats = {
      route: null,
      protocol: null,
      roundTrip: null,
      buffer: null,
      micLevel: webrtc.micLevel(),
      peerLevel: null,
    };

    let report: StatsLike;

    try {
      report = await this.peer.getStats();
    } catch {
      return stats;
    }

    const byId = new Map<string, Record<string, unknown>>();
    let selectedId: string | null = null;
    const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

    report.forEach((stat) => {
      byId.set(stat.id as string, stat);

      if (stat.type === "transport" && typeof stat.selectedCandidatePairId === "string") {
        selectedId = stat.selectedCandidatePairId;
      }
    });

    let pair: Record<string, unknown> | undefined;
    let remoteRoundTrip: number | null = null;

    for (const stat of byId.values()) {
      switch (stat.type) {
        case "candidate-pair":
          // Firefox marks the pair in use itself.
          if (stat.id === selectedId || (!selectedId && stat.selected === true)) {
            pair = stat;
          }
          break;

        case "inbound-rtp": {
          if (stat.kind !== "audio") {
            break;
          }

          const delay = num(stat.jitterBufferDelay);
          const emitted = num(stat.jitterBufferEmittedCount);
          stats.buffer = delay !== null && emitted ? Math.round((delay / emitted) * 1000) : null;
          stats.peerLevel = num(stat.audioLevel) ?? this.levelFromEnergy(stat);
          break;
        }

        case "media-source":
          if (stat.kind === "audio") {
            stats.micLevel ??= num(stat.audioLevel);
          }
          break;

        case "remote-inbound-rtp":
          remoteRoundTrip ??= num(stat.roundTripTime);
          break;
      }
    }

    if (pair) {
      const local = byId.get(pair.localCandidateId as string);
      const remote = byId.get(pair.remoteCandidateId as string);
      const relayed = local?.candidateType === "relay" || remote?.candidateType === "relay";
      const protocol = relayed && local?.candidateType === "relay" ? local.relayProtocol : local?.protocol;

      stats.route = relayed ? "relay" : "direct";
      stats.protocol = protocol === "udp" || protocol === "tcp" ? protocol : null;
      remoteRoundTrip = num(pair.currentRoundTripTime) ?? remoteRoundTrip;
    }

    stats.roundTrip = remoteRoundTrip === null ? null : Math.round(remoteRoundTrip * 1000);

    return stats;
  }

  private levelFromEnergy(stat: Record<string, unknown>) {
    const total = stat.totalAudioEnergy;
    const duration = stat.totalSamplesDuration;

    if (typeof total !== "number" || typeof duration !== "number") {
      return null;
    }

    const last = this.energy;
    this.energy = { total, duration };

    if (!last || duration <= last.duration) {
      return null;
    }

    return Math.sqrt((total - last.total) / (duration - last.duration));
  }

  // Whether the other side's app can take video.
  get canSendVideo() {
    return Boolean(this.video);
  }

  // The camera to send, or null for none.
  async setCamera(track: TrackLike | null) {
    this.camera = track;
    await this.video?.sender.replaceTrack(track);
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
    this.remote = null;
    this.camera = null;
    webrtc.playRemote(null);
  }
}
