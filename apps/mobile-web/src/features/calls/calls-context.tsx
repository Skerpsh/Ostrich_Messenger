import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Platform, StyleSheet, View } from "react-native";
import CallScreen from "./call-screen";
import { useAuth } from "@/features/auth/auth";
import { useChats } from "@/features/chats/chats";
import { useOutbox } from "@/features/chat/outbox";
import { useRealtime } from "@/api/realtime-context";
import { getIceServers, type Chat } from "@/api/api";
import { formatDuration } from "@/features/chat/attachments";
import type { CallStats } from "./call-connection";
import { CallSession, type CallView } from "./calls";
import { newMessageId } from "@/crypto/crypto";
import type { Phrase } from "./handshake";
import { checkPeerKey } from "@/crypto/known-keys";
import { encodePayload, type CallEntry } from "@/features/chat/payload";
import { encryptForChat } from "@/features/chat/use-chat-crypto";
import { useLatest } from "@/ui/use-latest";
import { webrtc } from "./webrtc";

// The call of this device (one at a time, see features/calls/calls.ts), on top of
// every screen: incoming calls ring wherever the user is.

type CallsValue = {
  call: CallView | null;
  // The call screen is hidden (a bar at the top brings it back).
  minimized: boolean;
  setMinimized: (minimized: boolean) => void;
  // Why a call cannot start in this chat, or null.
  callBlocker: (chat: Chat) => string | null;
  // Returns an error to show, or null when the call has started; video:
  // with the camera on.
  startCall: (chat: Chat, video?: boolean) => Promise<string | null>;
  // video: with the camera on.
  accept: (video: boolean) => void;
  decline: () => void;
  hangUp: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  toggleCamera: () => void;
  switchCamera: () => void;
  pickPhrase: (phrase: Phrase | null) => void;
  // In a tap: plays the other side's audio the browser held back.
  playAudio: () => void;
  stats: () => Promise<CallStats | null>;
};

const CallsContext = createContext<CallsValue | null>(null);

const live = (session: CallSession | null) => (session && !session.over ? session : null);

// An ended call stays on screen this long, saying how it ended.
const ENDED_SHOWN_MS = 1800;

// The entry's text for clients that do not know call entries.
function entryFallback(entry: CallEntry) {
  const [icon, kind] = entry.video ? ["🎥", "video call"] : ["📞", "call"];

  switch (entry.outcome) {
    case "answered":
      return `${icon} ${entry.video ? "Video call" : "Call"}, ${formatDuration(entry.duration ?? 0)}`;
    case "declined":
      return `${icon} Declined ${kind}`;
    default:
      return `${icon} Missed ${kind}`;
  }
}

export function CallsProvider({ children }: { children: ReactNode }) {
  const { state, withToken } = useAuth();
  const { status, subscribeCalls, sendCall, holdConnection } = useRealtime();
  const { chats, reload } = useChats();
  const outbox = useOutbox();

  const user = state.status === "signedIn" ? state.user : null;
  const privateKey = state.status === "signedIn" ? state.privateKey : null;

  const [call, setCall] = useState<CallView | null>(null);
  const [minimized, setMinimized] = useState(false);
  const sessionRef = useRef<CallSession | null>(null);
  const chatsRef = useLatest(chats);
  const outboxRef = useLatest(outbox);

  const active = () => live(sessionRef.current);

  const depsRef = useLatest(
    user && privateKey
      ? {
          ownId: user.id,
          privateKey,
          send: sendCall,
          iceServers: () => withToken(getIceServers),
          postEntry: (chat: Chat, entry: CallEntry) => {
            const id = newMessageId();

            try {
              outboxRef.current.send({
                id,
                chatId: chat.id,
                senderId: user.id,
                content: encryptForChat(
                  chat,
                  encodePayload({ text: entryFallback(entry), call: entry }),
                  { id, sender_id: user.id },
                  privateKey,
                ),
                replyTo: null,
              });
            } catch {
              // The chat's keys are gone (e.g. logged out meanwhile).
            }
          },
        }
      : null,
  );

  const track = useCallback(
    (session: CallSession) => {
      sessionRef.current = session;
      setMinimized(false);
      holdConnection(true);

      return (view: CallView) => {
        if (sessionRef.current !== session) {
          return;
        }

        setCall(view);

        if (view.phase === "ended") {
          holdConnection(false);
          setTimeout(() => {
            if (sessionRef.current === session) {
              sessionRef.current = null;
              setCall(null);
            }
          }, ENDED_SHOWN_MS);
        }
      };
    },
    [holdConnection],
  );

  // Incoming calls and the current call's events.
  useEffect(
    () =>
      subscribeCalls((event) => {
        if (event.type !== "call_incoming") {
          if (sessionRef.current?.id === event.callId) {
            sessionRef.current.handle(event);
          }
          return;
        }

        const deps = depsRef.current;

        // One call at a time (the server says "busy" to other callers).
        if (!deps || live(sessionRef.current)) {
          return;
        }

        (async () => {
          let chat = chatsRef.current?.find((c) => c.id === event.call.chatId);

          if (!chat) {
            await reload().catch(() => {});
            chat = chatsRef.current?.find((c) => c.id === event.call.chatId);
          }

          if (!chat || live(sessionRef.current)) {
            return;
          }

          let onChange: (view: CallView) => void = () => {};
          const session = CallSession.incoming(event, chat, { ...deps, onChange: (view) => onChange(view) });

          if (!session) {
            return;
          }

          onChange = track(session);
          setCall(session.view);
          notifyIncoming(chat, session.view.video);
        })();
      }),
    [subscribeCalls, depsRef, chatsRef, reload, track],
  );

  // Back online: the new socket takes this device's place in the call.
  const wasOnline = useRef(status === "online");

  useEffect(() => {
    if (status === "online" && !wasOnline.current) {
      live(sessionRef.current)?.resume();
    }

    wasOnline.current = status === "online";
  }, [status]);

  // Web: closing the tab hangs up at once (the server would wait for the
  // socket to come back).
  useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }

    const leave = () => live(sessionRef.current)?.hangUp();
    window.addEventListener("pagehide", leave);

    return () => window.removeEventListener("pagehide", leave);
  }, []);

  // Logged out: the call ends.
  useEffect(() => {
    if (!user) {
      live(sessionRef.current)?.hangUp();
    }
  }, [user]);

  const callBlocker = useCallback((chat: Chat) => {
    if (chat.type !== "direct") {
      return "Calls are only in direct chats";
    }

    if (chat.blocked) {
      return chat.blocked_by_me ? `Unblock @${chat.username} to call them` : `You can't call @${chat.username}`;
    }

    if (!chat.public_key) {
      return `@${chat.username ?? "…"} has not set up end-to-end encryption yet`;
    }

    return null;
  }, []);

  const startCall = useCallback(
    async (chat: Chat, video = false) => {
      // Still in the click (Safari plays the call's audio only then).
      webrtc.unlockAudio();

      const deps = depsRef.current;
      const blocker = callBlocker(chat);

      if (blocker) {
        return blocker;
      }

      if (!deps) {
        return "Log in to call";
      }

      if (live(sessionRef.current)) {
        return "You are already in a call";
      }

      if (status !== "online") {
        return "You're offline";
      }

      if ((await checkPeerKey(deps.ownId, chat.user_id ?? "", chat.public_key ?? "")) === "changed") {
        return `@${chat.username}'s security key has changed: compare the safety code in the chat menu first`;
      }

      let onChange: (view: CallView) => void = () => {};
      const session = CallSession.outgoing(chat, { ...deps, onChange: (view) => onChange(view) }, video);
      onChange = track(session);
      setCall(session.view);

      return null;
    },
    [depsRef, callBlocker, status, track],
  );

  const value: CallsValue = {
    call,
    minimized,
    setMinimized,
    callBlocker,
    startCall,
    accept: (video) => {
      webrtc.unlockAudio();
      active()?.accept(video);
    },
    decline: () => active()?.decline(),
    hangUp: () => active()?.hangUp(),
    toggleMute: () => active()?.toggleMute(),
    toggleSpeaker: () => active()?.toggleSpeaker(),
    toggleCamera: () => active()?.toggleCamera(),
    switchCamera: () => active()?.switchCamera(),
    pickPhrase: (phrase) => active()?.pick(phrase),
    playAudio: () => {
      webrtc.unlockAudio();
      active()?.playAudio();
    },
    stats: async () => (await active()?.stats()) ?? null,
  };

  return (
    <CallsContext value={value}>
      <View style={styles.fill}>
        {children}
        {/* Always there: an ended call's screen animates out first. */}
        <CallScreen />
      </View>
    </CallsContext>
  );
}

export function useCalls() {
  const context = useContext(CallsContext);

  if (!context) {
    throw new Error("useCalls must be used inside CallsProvider");
  }

  return context;
}

// Web: a notification when the tab is in the background (the apps ring
// only while open in this version).
function notifyIncoming(chat: Chat, video: boolean) {
  if (
    Platform.OS !== "web" ||
    typeof document === "undefined" ||
    !document.hidden ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return;
  }

  const notification = new Notification(`@${chat.username} is ${video ? "video " : ""}calling`, {
    body: "Open Ostrich to answer",
    tag: `call-${chat.id}`,
    icon: "/favicon.ico",
    requireInteraction: true,
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
