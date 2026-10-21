import type { Chat } from "@/api/api";
import {
  CallConnection,
  type Candidate,
  type Facing,
  type IceServer,
  type LinkState,
  type StreamLike,
} from "./call-connection";
import { decryptCallSignal, encryptCallSignal, newMessageId, type CallRef } from "@/crypto/crypto";
import {
  commitment,
  handshakePhrases,
  newNonce,
  phraseChoices,
  samePhrase,
  type Phrase,
} from "./handshake";
import type { CallEntry, CallOutcome } from "@/features/chat/payload";
import type { CallCommand, CallEvent } from "@/api/realtime";
import { callSounds, webrtc } from "./webrtc";

// One-to-one audio and video calls in direct chats. The backend (calls.ts) passes
// the signals between the two devices; they are encrypted for the other
// member (crypto.ts):
//   offer    {k "offer", sdp, commit, t, v} in call_start: the caller's
//            session description, the commitment to its handshake nonce,
//            when it was made (old offers sent again are ignored), v: a
//            video call
//   answer   {k "answer", sdp, nonce}     in call_answer
//   then, in call_signal: {k "reveal", nonce} (the caller's nonce, after
//   the answer), {k "ice", c: [candidates]}, {k "mute", on},
//   {k "camera", on} (the video is shown only while it is on),
//   {k "heard", ok} (the handshake: whether the other's sentence was
//   right), {k "reoffer"/"reanswer", sdp} (new addresses after a network
//   change; the caller starts it).
// The caller's app writes the call in the chat when it ends (payload.ts).

export type CallPhase = "outgoing" | "incoming" | "connecting" | "active" | "reconnecting" | "ended";

export type HandshakeView =
  | {
      broken: false;
      // The sentence to read aloud, and the four to find the other's in.
      mine: Phrase;
      choices: Phrase[];
      heard: "right" | "wrong" | null;
      // What the other side picked.
      peerHeard: "right" | "wrong" | null;
    }
  // The caller's nonce did not match what its offer committed to.
  | { broken: true };

export type CallView = {
  id: string;
  chat: Chat;
  direction: "outgoing" | "incoming";
  phase: CallPhase;
  // When the audio first connected.
  connectedAt: number | null;
  muted: boolean;
  speaker: boolean;
  peerMuted: boolean;
  // Started as a video call.
  video: boolean;
  // This side's camera (shown while ringing too), and the other's video.
  camera: boolean;
  localVideo: StreamLike | null;
  facing: Facing;
  canSwitchCamera: boolean;
  peerCamera: boolean;
  remoteVideo: StreamLike | null;
  // A short message, e.g. that the camera can't be used.
  notice: string | null;
  // The browser did not let the other side's audio play: a tap starts it
  // (playAudio).
  audioBlocked: boolean;
  handshake: HandshakeView | null;
  // Phase "ended": what happened, e.g. "Declined".
  endText?: string;
};

type Signal =
  | { k: "offer"; sdp: string; commit: string; t: number; v?: boolean }
  | { k: "answer"; sdp: string; nonce: string }
  | { k: "reveal"; nonce: string }
  | { k: "ice"; c: Candidate[] }
  | { k: "mute"; on: boolean }
  | { k: "camera"; on: boolean }
  | { k: "heard"; ok: boolean }
  | { k: "reoffer"; sdp: string }
  | { k: "reanswer"; sdp: string };

export type CallDeps = {
  ownId: string;
  privateKey: Uint8Array;
  send: (command: CallCommand) => boolean;
  iceServers: () => Promise<IceServer[]>;
  // The caller's entry in the chat, when the call ends.
  postEntry: (chat: Chat, entry: CallEntry) => void;
  onChange: (view: CallView) => void;
};

// How long a call rings before the caller's app gives up.
const RING_MS = 45_000;
const KEEPALIVE_MS = 15_000;
// Lost audio: new addresses are tried after this, the call ends after
// LOST_MS.
const RESTART_MS = 3_000;
const LOST_MS = 30_000;
// Network candidates are sent in batches, at most this often.
const CANDIDATES_MS = 150;
// Offers older than this (or this far ahead: clocks differ) are ignored.
const OFFER_MAX_AGE_MS = 2 * 60_000;

// Calls this device has seen, so an offer sent again cannot ring again.
const seen = new Set<string>();

const NONCE_RE = /^[0-9a-f]{32}$/i;

function readSignal(value: unknown): Signal | null {
  const s = value as Partial<Record<string, unknown>> | null;

  if (!s || typeof s.k !== "string") {
    return null;
  }

  const sdp = typeof s.sdp === "string" && s.sdp.length < 30_000 ? s.sdp : null;

  switch (s.k) {
    case "offer":
      return sdp && typeof s.commit === "string" && /^[0-9a-f]{64}$/.test(s.commit) && typeof s.t === "number"
        ? { k: "offer", sdp, commit: s.commit, t: s.t, v: s.v === true }
        : null;
    case "answer":
      return sdp && typeof s.nonce === "string" && NONCE_RE.test(s.nonce) ? { k: "answer", sdp, nonce: s.nonce } : null;
    case "reveal":
      return typeof s.nonce === "string" && NONCE_RE.test(s.nonce) ? { k: "reveal", nonce: s.nonce } : null;
    case "ice":
      return Array.isArray(s.c)
        ? {
            k: "ice",
            c: s.c
              .filter((c): c is Candidate => typeof c?.candidate === "string")
              .slice(0, 50)
              .map((c) => ({
                candidate: c.candidate,
                sdpMid: typeof c.sdpMid === "string" ? c.sdpMid : null,
                sdpMLineIndex: typeof c.sdpMLineIndex === "number" ? c.sdpMLineIndex : null,
              })),
          }
        : null;
    case "mute":
    case "camera":
      return typeof s.on === "boolean" ? { k: s.k, on: s.on } : null;
    case "heard":
      return typeof s.ok === "boolean" ? { k: "heard", ok: s.ok } : null;
    case "reoffer":
    case "reanswer":
      return sdp ? { k: s.k, sdp } : null;
    default:
      return null;
  }
}

export class CallSession {
  view: CallView;

  private connection: CallConnection | null = null;
  private readonly nonce = newNonce();
  // Incoming: the caller's offer, then its nonce once revealed.
  private offer: { sdp: string; commit: string } | null = null;
  private peerNonce: string | null = null;
  // Answered: signals can go to the other side.
  private answered = false;
  private candidates: Candidate[] = [];
  private candidatesTimer: ReturnType<typeof setTimeout> | null = null;
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lostTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private ended = false;
  private cameraBusy = false;
  // Video was on screen (the screen kept on, the speaker turned on once).
  private videoShown = false;
  private speakerTouched = false;

  private constructor(
    private deps: CallDeps,
    id: string,
    chat: Chat,
    direction: "outgoing" | "incoming",
    video: boolean,
  ) {
    seen.add(id);
    this.view = {
      id,
      chat,
      direction,
      phase: direction,
      connectedAt: null,
      muted: false,
      speaker: false,
      peerMuted: false,
      video,
      camera: false,
      localVideo: null,
      facing: "user",
      canSwitchCamera: false,
      peerCamera: video && direction === "incoming",
      remoteVideo: null,
      notice: null,
      audioBlocked: false,
      handshake: null,
    };
  }

  get id() {
    return this.view.id;
  }

  get over() {
    return this.ended;
  }

  // Calls the chat's other member; video: with the camera on.
  static outgoing(chat: Chat, deps: CallDeps, video = false) {
    const session = new CallSession(deps, newMessageId(), chat, "outgoing", video);
    session.call();
    return session;
  }

  // A call to this user; null if its offer cannot be read or is old.
  static incoming(event: Extract<CallEvent, { type: "call_incoming" }>, chat: Chat, deps: CallDeps) {
    const { id, callerId } = event.call;

    if (seen.has(id) || !chat.public_key || chat.user_id !== callerId) {
      return null;
    }

    const signal = readSignal(
      decryptCallSignal(event.data, { chatId: chat.id, callId: id, senderId: callerId }, deps.privateKey, chat.public_key),
    );

    if (signal?.k !== "offer" || Math.abs(Date.now() - signal.t) > OFFER_MAX_AGE_MS) {
      return null;
    }

    const session = new CallSession(deps, id, chat, "incoming", signal.v === true);
    session.offer = { sdp: signal.sdp, commit: signal.commit };
    callSounds.ringing();

    // A video call: this side's camera, to see before answering with it.
    if (session.view.video) {
      session.startCamera();
    }

    return session;
  }

  private update(change: Partial<CallView>) {
    this.view = { ...this.view, ...change };
    this.videoChanged();
    this.deps.onChange(this.view);
  }

  // Video on screen: the screen stays on, and the phone's speaker is
  // turned on (once: the user may turn it off).
  private videoChanged() {
    const { camera, peerCamera, remoteVideo, phase } = this.view;
    const shown = camera || (peerCamera && Boolean(remoteVideo));

    // Ended: callSounds.stop() has put everything back.
    if (phase === "ended") {
      this.videoShown = false;
      return;
    }

    if (shown === this.videoShown) {
      return;
    }

    this.videoShown = shown;
    callSounds.video(shown);

    if (shown && !this.speakerTouched && !this.view.speaker && callSounds.canUseSpeaker) {
      callSounds.speaker(true);
      this.view = { ...this.view, speaker: true };
    }
  }

  private notify(notice: string) {
    clearTimeout(this.noticeTimer ?? undefined);
    this.update({ notice });
    this.noticeTimer = setTimeout(() => this.update({ notice: null }), 4000);
  }

  private ref(senderId: string): CallRef {
    return { chatId: this.view.chat.id, callId: this.id, senderId };
  }

  private seal(signal: Signal) {
    return encryptCallSignal(signal, this.ref(this.deps.ownId), this.deps.privateKey, this.view.chat.public_key ?? "");
  }

  private open(data: string) {
    const peerId = this.view.chat.user_id ?? "";
    return readSignal(decryptCallSignal(data, this.ref(peerId), this.deps.privateKey, this.view.chat.public_key ?? ""));
  }

  private signal(signal: Signal) {
    if (this.answered && !this.ended) {
      this.deps.send({ type: "call_signal", callId: this.id, data: this.seal(signal) });
    }
  }

  private async connect() {
    let servers: IceServer[] = [];

    try {
      servers = await this.deps.iceServers();
    } catch {
      // Direct connections only.
    }

    const connection = await CallConnection.open(servers, {
      onRemoteVideo: (remoteVideo) => {
        if (!this.ended) {
          this.update({ remoteVideo });
        }
      },
      onCandidate: (candidate) => this.queueCandidate(candidate),
      onState: (state) => this.linkChanged(state),
      onPlayback: (playing) => {
        if (this.view.audioBlocked === playing && !this.ended) {
          this.update({ audioBlocked: !playing });
        }
      },
    });

    if (this.ended) {
      connection.close();
      return null;
    }

    this.connection = connection;
    await connection.setCamera(this.cameraTrack());
    return connection;
  }

  private cameraTrack() {
    return this.view.localVideo?.getTracks()[0] ?? null;
  }

  // Turns this side's camera on (false if it can't be used).
  private async startCamera() {
    if (this.cameraBusy || this.view.camera) {
      return this.view.camera;
    }

    this.cameraBusy = true;

    try {
      const stream = await webrtc.getCamera(this.view.facing);

      if (this.ended) {
        stopStream(stream);
        return false;
      }

      await this.connection?.setCamera(stream.getTracks()[0] ?? null);
      this.update({ camera: true, localVideo: stream });
      this.signal({ k: "camera", on: true });

      webrtc.cameraCount().then((count) => {
        if (!this.ended && count > 1 !== this.view.canSwitchCamera) {
          this.update({ canSwitchCamera: count > 1 });
        }
      });

      return true;
    } catch (e) {
      this.notify(cameraError(e));
      return false;
    } finally {
      this.cameraBusy = false;
    }
  }

  private stopCamera() {
    if (!this.view.localVideo) {
      return;
    }

    stopStream(this.view.localVideo);
    this.connection?.setCamera(null).catch(() => {});
    this.update({ camera: false, localVideo: null });
    this.signal({ k: "camera", on: false });
  }

  private async call() {
    callSounds.calling();

    if (this.view.video) {
      await this.startCamera();
    }

    let sdp: string;

    try {
      const connection = await this.connect();

      if (!connection) {
        return;
      }

      sdp = await connection.offer();
    } catch (e) {
      this.finish(microphoneError(e));
      return;
    }

    if (this.ended) {
      return;
    }

    const data = this.seal({ k: "offer", sdp, commit: commitment(this.nonce), t: Date.now(), v: this.view.video });

    if (!this.deps.send({ type: "call_start", chatId: this.view.chat.id, callId: this.id, data })) {
      this.finish("You're offline");
      return;
    }

    this.ringTimer = setTimeout(() => this.hangUp(), RING_MS);
  }

  // video: with this side's camera on.
  async accept(video = false) {
    if (this.view.direction !== "incoming" || this.view.phase !== "incoming" || !this.offer) {
      return;
    }

    callSounds.connected();
    this.update({ phase: "connecting" });

    if (!video) {
      this.stopCamera();
    } else if (!this.view.camera) {
      // The preview did not start (e.g. the camera was not allowed yet).
      this.startCamera();
    }

    let sdp: string;

    try {
      const connection = await this.connect();

      if (!connection) {
        return;
      }

      sdp = await connection.answer(this.offer.sdp);
    } catch (e) {
      this.deps.send({ type: "call_decline", callId: this.id });
      this.finish(microphoneError(e));
      return;
    }

    if (this.ended) {
      return;
    }

    if (!this.deps.send({ type: "call_answer", callId: this.id, data: this.seal({ k: "answer", sdp, nonce: this.nonce }) })) {
      this.finish("You're offline");
      return;
    }

    this.becameAnswered();
    this.signal({ k: "camera", on: this.view.camera });
  }

  decline() {
    if (this.view.phase === "incoming") {
      this.deps.send({ type: "call_decline", callId: this.id });
      this.finish("Declined");
    }
  }

  hangUp() {
    if (this.ended) {
      return;
    }

    this.deps.send({ type: "call_hangup", callId: this.id });

    if (this.view.direction === "outgoing" && !this.answered) {
      this.finish("No answer", "missed");
    } else {
      this.finish("Call ended", "answered");
    }
  }

  toggleMute() {
    const muted = !this.view.muted;
    this.connection?.setMuted(muted);
    this.update({ muted });
    this.signal({ k: "mute", on: muted });
  }

  async toggleCamera() {
    if (this.view.camera) {
      this.stopCamera();
    } else {
      await this.startCamera();
    }
  }

  // Front ↔ back (phones).
  async switchCamera() {
    if (!this.view.camera || this.cameraBusy) {
      return;
    }

    const facing: Facing = this.view.facing === "user" ? "environment" : "user";

    // Phones open one camera at a time: the old one goes first.
    if (this.view.localVideo) {
      stopStream(this.view.localVideo);
    }

    this.update({ camera: false, localVideo: null, facing });
    await this.startCamera();
  }

  toggleSpeaker() {
    this.speakerTouched = true;
    const speaker = !this.view.speaker;
    callSounds.speaker(speaker);
    this.update({ speaker });
  }

  // In a tap: the other side's audio, after the browser held it back.
  playAudio() {
    this.connection?.playAgain((playing) => {
      if (!this.ended) {
        this.update({ audioBlocked: !playing });
      }
    });
  }

  // How the audio goes (call-connection.ts), null before it connects.
  async stats() {
    return this.connection && this.view.connectedAt ? this.connection.stats() : null;
  }

  // The handshake: the sentence chosen as the other's (null: none of them).
  pick(choice: Phrase | null) {
    const handshake = this.view.handshake;

    if (!handshake || handshake.broken || handshake.heard) {
      return;
    }

    const theirs = this.theirPhrase();
    const ok = Boolean(choice && theirs && samePhrase(choice, theirs));

    this.update({ handshake: { ...handshake, heard: ok ? "right" : "wrong" } });
    this.signal({ k: "heard", ok });
  }

  // The websocket has reconnected: this device's new socket takes its
  // place in the call.
  resume() {
    if (!this.ended && this.view.phase !== "incoming") {
      this.deps.send({ type: "call_resume", callId: this.id });
    }
  }

  async handle(event: CallEvent) {
    if (this.ended) {
      return;
    }

    switch (event.type) {
      case "call_answered": {
        const signal = this.open(event.data);

        if (this.view.direction !== "outgoing" || this.answered || signal?.k !== "answer" || !this.connection) {
          return;
        }

        this.peerNonce = signal.nonce;
        this.becameAnswered();
        callSounds.connected();
        this.update({ phase: "connecting" });

        try {
          await this.connection.accept(signal.sdp);
        } catch {
          this.hangUp();
          return;
        }

        this.signal({ k: "reveal", nonce: this.nonce });
        this.signal({ k: "camera", on: this.view.camera });
        this.tryHandshake();
        return;
      }

      case "call_signal": {
        const signal = this.open(event.data);

        if (signal) {
          await this.onSignal(signal);
        }
        return;
      }

      case "call_ended":
        this.serverEnded(event.reason);
        return;

      case "call_error":
        this.finish(event.error, event.code === "busy" || event.code === "unavailable" ? "missed" : undefined);
        return;
    }
  }

  private async onSignal(signal: Signal) {
    const connection = this.connection;

    if (!connection) {
      return;
    }

    switch (signal.k) {
      case "ice":
        for (const candidate of signal.c) {
          await connection.addCandidate(candidate);
        }
        return;

      case "reveal":
        if (this.view.direction === "incoming" && !this.peerNonce && this.offer) {
          this.peerNonce = signal.nonce;

          if (commitment(signal.nonce) !== this.offer.commit) {
            this.update({ handshake: { broken: true } });
            return;
          }

          this.tryHandshake();
        }
        return;

      case "mute":
        this.update({ peerMuted: signal.on });
        return;

      case "camera":
        this.update({ peerCamera: signal.on });
        return;

      case "heard": {
        const handshake = this.view.handshake;

        if (handshake && !handshake.broken) {
          this.update({ handshake: { ...handshake, peerHeard: signal.ok ? "right" : "wrong" } });
        }
        return;
      }

      case "reoffer":
        if (this.view.direction === "incoming") {
          try {
            this.signal({ k: "reanswer", sdp: await connection.answer(signal.sdp) });
          } catch {
            // The caller tries again.
          }
        }
        return;

      case "reanswer":
        if (this.view.direction === "outgoing") {
          await connection.accept(signal.sdp).catch(() => {});
        }
        return;
    }
  }

  private serverEnded(reason: string) {
    const outgoing = this.view.direction === "outgoing";

    switch (reason) {
      case "answered_elsewhere":
        // This device answered: the event is for the callee's others.
        if (this.view.phase === "incoming") {
          this.finish("Answered on another device");
        }
        return;

      case "declined":
        this.finish("Declined", outgoing ? "declined" : undefined);
        return;

      case "cancelled":
      case "timeout":
        this.finish(outgoing ? "No answer" : "Missed call", outgoing ? "missed" : undefined);
        return;

      case "disconnected":
        this.finish("Connection lost", outgoing ? (this.answered ? "answered" : "missed") : undefined);
        return;

      default:
        this.finish("Call ended", outgoing ? (this.answered ? "answered" : "missed") : undefined);
    }
  }

  private becameAnswered() {
    this.answered = true;
    clearTimeout(this.ringTimer ?? undefined);
    this.flushCandidates();
    this.keepAlive = setInterval(
      () => this.deps.send({ type: "call_keepalive", callId: this.id }),
      KEEPALIVE_MS,
    );
  }

  private queueCandidate(candidate: Candidate) {
    this.candidates.push(candidate);

    if (this.answered && !this.candidatesTimer) {
      this.candidatesTimer = setTimeout(() => this.flushCandidates(), CANDIDATES_MS);
    }
  }

  private flushCandidates() {
    clearTimeout(this.candidatesTimer ?? undefined);
    this.candidatesTimer = null;

    if (this.candidates.length === 0 || !this.answered) {
      return;
    }

    const batch = this.candidates.splice(0, 20);
    this.signal({ k: "ice", c: batch });

    if (this.candidates.length > 0) {
      this.candidatesTimer = setTimeout(() => this.flushCandidates(), CANDIDATES_MS);
    }
  }

  private linkChanged(state: LinkState) {
    if (this.ended || !this.answered) {
      return;
    }

    if (state === "connected") {
      clearTimeout(this.restartTimer ?? undefined);
      clearTimeout(this.lostTimer ?? undefined);
      this.restartTimer = null;
      this.lostTimer = null;
      this.update({ phase: "active", connectedAt: this.view.connectedAt ?? Date.now() });
      this.tryHandshake();
      return;
    }

    if (state !== "disconnected" && state !== "failed") {
      return;
    }

    if (this.view.phase === "active") {
      this.update({ phase: "reconnecting" });
    }

    this.lostTimer ??= setTimeout(() => {
      this.deps.send({ type: "call_hangup", callId: this.id });
      this.finish("Connection lost", this.view.direction === "outgoing" ? "answered" : undefined);
    }, LOST_MS);

    // The caller looks for new addresses (e.g. Wi-Fi → mobile data).
    if (this.view.direction === "outgoing" && !this.restartTimer) {
      this.restartTimer = setTimeout(
        () => {
          this.restartTimer = null;
          this.restartIce();
        },
        state === "failed" ? 0 : RESTART_MS,
      );
    }
  }

  private async restartIce() {
    if (this.ended || this.view.phase === "active" || !this.connection) {
      return;
    }

    try {
      this.signal({ k: "reoffer", sdp: await this.connection.offer(true) });
    } catch {
      // Tried again on the next change of the connection.
    }
  }

  private theirPhrase() {
    return this.phrases()?.[this.view.direction === "outgoing" ? "callee" : "caller"] ?? null;
  }

  private phrases() {
    const fingerprints = this.connection?.fingerprints();

    if (!fingerprints?.local || !fingerprints.remote || !this.peerNonce) {
      return null;
    }

    const outgoing = this.view.direction === "outgoing";

    return handshakePhrases({
      callId: this.id,
      callerFingerprint: outgoing ? fingerprints.local : fingerprints.remote,
      calleeFingerprint: outgoing ? fingerprints.remote : fingerprints.local,
      callerNonce: outgoing ? this.nonce : this.peerNonce,
      calleeNonce: outgoing ? this.peerNonce : this.nonce,
    });
  }

  private tryHandshake() {
    if (this.view.handshake) {
      return;
    }

    const phrases = this.phrases();

    if (!phrases) {
      return;
    }

    const outgoing = this.view.direction === "outgoing";
    const theirs = outgoing ? phrases.callee : phrases.caller;

    this.update({
      handshake: {
        broken: false,
        mine: outgoing ? phrases.caller : phrases.callee,
        choices: phraseChoices(theirs),
        heard: null,
        peerHeard: null,
      },
    });
  }

  // Ends the call on this device; the caller writes it in the chat.
  private finish(endText: string, outcome?: CallOutcome) {
    if (this.ended) {
      return;
    }

    this.ended = true;

    for (const timer of [this.ringTimer, this.candidatesTimer, this.restartTimer, this.lostTimer, this.noticeTimer]) {
      clearTimeout(timer ?? undefined);
    }

    clearInterval(this.keepAlive ?? undefined);
    this.connection?.close();

    if (this.view.localVideo) {
      stopStream(this.view.localVideo);
    }

    callSounds.stop();

    if (this.view.direction === "outgoing" && outcome) {
      const connectedAt = this.view.connectedAt;

      this.deps.postEntry(this.view.chat, {
        id: this.id,
        outcome,
        ...(this.view.video ? { video: true } : {}),
        ...(outcome === "answered" ? { duration: connectedAt ? Date.now() - connectedAt : 0 } : {}),
      });
    }

    this.update({ phase: "ended", endText, camera: false, localVideo: null, remoteVideo: null, notice: null });
  }
}

function microphoneError(e: unknown) {
  const name = (e as { name?: string } | null)?.name;

  return name === "NotAllowedError" || name === "SecurityError"
    ? "Ostrich can't use the microphone: allow it to call"
    : name === "NotFoundError"
      ? "No microphone found"
      : "Couldn't start the call";
}

function cameraError(e: unknown) {
  const name = (e as { name?: string } | null)?.name;

  return name === "NotAllowedError" || name === "SecurityError"
    ? "Ostrich can't use the camera: allow it in the settings"
    : name === "NotFoundError"
      ? "No camera found"
      : "The camera is busy or not available";
}

function stopStream(stream: StreamLike) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

// What the chat shows for a call entry, from this user's side.
export function callEntryText(entry: CallEntry, own: boolean) {
  const kind = entry.video ? "video call" : "call";

  switch (entry.outcome) {
    case "answered":
      return own ? `Outgoing ${kind}` : `Incoming ${kind}`;
    case "declined":
      return own ? "Declined" : `Declined ${kind}`;
    default:
      return own ? "No answer" : `Missed ${kind}`;
  }
}
