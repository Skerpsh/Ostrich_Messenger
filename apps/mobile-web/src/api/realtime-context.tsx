import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";
import { useAuth } from "@/features/auth/auth";
import {
  getMe,
  getWsTicket,
  SessionExpiredError,
  type Message,
} from "./api";
import {
  RealtimeConnection,
  type CallCommand,
  type CallEvent,
  type ConnectionStatus,
  type ChatEvent,
  type PresenceEvent,
  type ProfileEvent,
  type ReadEvent,
} from "./realtime";

export type Presence = {
  online: boolean;
  lastSeenAt: string | null;
};

type ChatListener = {
  onMessage: (message: Message) => void;
  onJoined: () => void;
};

// Receives the events of all chats (for the chats list).
export type EventListener = {
  onMessage?: (message: Message) => void;
  onRead?: (event: ReadEvent) => void;
  onProfile?: (event: ProfileEvent) => void;
  onEvent?: (event: ChatEvent) => void;
};

type RealtimeContextValue = {
  status: ConnectionStatus;
  presence: Record<string, Presence>;
  // Presence from REST responses (chats list); live events override it.
  seedPresence: (entries: { userId: string; presence: Presence }[]) => void;
  // Receive a chat's messages while the returned function is not called.
  subscribeChat: (chatId: string, listener: ChatListener) => () => void;
  // Receive all chats' events while the returned function is not called.
  subscribeEvents: (listener: EventListener) => () => void;
  // "typing…" in the chat, for the other member.
  sendTyping: (chatId: string) => void;
  // Calls (features/calls/calls-context.tsx): their events, and sending; false if not
  // connected.
  subscribeCalls: (listener: (event: CallEvent) => void) => () => void;
  sendCall: (command: CallCommand) => boolean;
  // Mobile: keeps the connection open in the background while true.
  holdConnection: (hold: boolean) => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

// Keeps the session's websocket open while signed in (and, on mobile, while
// the app is in the foreground), so the user is shown online.
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { state, withToken } = useAuth();
  const token = state.status === "signedIn" ? state.token : null;

  const [status, setStatus] = useState<ConnectionStatus>("offline");
  const [presence, setPresence] = useState<Record<string, Presence>>({});

  const connectionRef = useRef<RealtimeConnection | null>(null);
  const listenersRef = useRef(new Map<string, Set<ChatListener>>());
  const eventListenersRef = useRef(new Set<EventListener>());
  const callListenersRef = useRef(new Set<(event: CallEvent) => void>());
  // A call keeps the connection in the background; when it ends there,
  // releaseRef closes it.
  const heldRef = useRef(false);
  const releaseRef = useRef(() => {});

  useEffect(() => {
    if (!token) {
      return;
    }

    const listeners = listenersRef.current;
    const eventListeners = eventListenersRef.current;
    const callListeners = callListenersRef.current;

    const connection = new RealtimeConnection(token, {
      onStatus: setStatus,
      onJoined: (chatId) => {
        for (const listener of listeners.get(chatId) ?? []) {
          listener.onJoined();
        }
      },
      onMessage: (message) => {
        for (const listener of listeners.get(message.chat_id) ?? []) {
          listener.onMessage(message);
        }

        for (const listener of eventListeners) {
          listener.onMessage?.(message);
        }
      },
      onRead: (event) => {
        for (const listener of eventListeners) {
          listener.onRead?.(event);
        }
      },
      onProfile: (event) => {
        for (const listener of eventListeners) {
          listener.onProfile?.(event);
        }
      },
      onEvent: (event) => {
        for (const listener of eventListeners) {
          listener.onEvent?.(event);
        }
      },
      onPresence: ({ userId, online, lastSeenAt }: PresenceEvent) =>
        setPresence((current) => ({
          ...current,
          [userId]: { online, lastSeenAt },
        })),
      onCall: (event) => {
        for (const listener of callListeners) {
          listener(event);
        }
      },
      // Errors only concern single requests (e.g. joining a chat that
      // does not exist); screens show their own REST errors.
      onError: () => {},
      getTicket: () => withToken(getWsTicket),
      shouldReconnect: async () => {
        try {
          await withToken(getMe);
          return true;
        } catch (e) {
          return !(e instanceof SessionExpiredError);
        }
      },
    });

    connectionRef.current = connection;

    for (const chatId of listeners.keys()) {
      connection.join(chatId);
    }

    connection.start();

    // Mobile: go offline in the background, reconnect when back; not
    // during a call (holdConnection), which still needs its signals.
    const subscription =
      Platform.OS === "web"
        ? null
        : AppState.addEventListener("change", (appState) => {
            if (appState === "active") {
              connection.start();
            } else if (appState === "background" && !heldRef.current) {
              connection.stop();
            }
          });

    releaseRef.current = () => {
      if (AppState.currentState === "background") {
        connection.stop();
      }
    };

    return () => {
      releaseRef.current = () => {};
      subscription?.remove();
      connection.stop();
      connectionRef.current = null;
      // Presence of the previous session's contacts.
      setPresence({});
    };
  }, [token, withToken]);

  const seedPresence = useCallback(
    (entries: { userId: string; presence: Presence }[]) => {
      setPresence((current) => {
        const next = { ...current };

        for (const { userId, presence } of entries) {
          next[userId] = presence;
        }

        return next;
      });
    },
    [],
  );

  const subscribeChat = useCallback(
    (chatId: string, listener: ChatListener) => {
      const listeners = listenersRef.current;
      let set = listeners.get(chatId);

      if (!set) {
        set = new Set();
        listeners.set(chatId, set);
        connectionRef.current?.join(chatId);
      }

      set.add(listener);

      return () => {
        set.delete(listener);

        if (set.size === 0) {
          listeners.delete(chatId);
          connectionRef.current?.leave(chatId);
        }
      };
    },
    [],
  );

  const subscribeEvents = useCallback((listener: EventListener) => {
    eventListenersRef.current.add(listener);

    return () => {
      eventListenersRef.current.delete(listener);
    };
  }, []);

  const sendTyping = useCallback((chatId: string) => {
    connectionRef.current?.typing(chatId);
  }, []);

  const subscribeCalls = useCallback((listener: (event: CallEvent) => void) => {
    callListenersRef.current.add(listener);

    return () => {
      callListenersRef.current.delete(listener);
    };
  }, []);

  const sendCall = useCallback(
    (command: CallCommand) => connectionRef.current?.call(command) ?? false,
    [],
  );

  const holdConnection = useCallback((hold: boolean) => {
    const was = heldRef.current;
    heldRef.current = hold;

    if (was && !hold) {
      releaseRef.current();
    }
  }, []);

  return (
    <RealtimeContext
      value={{
        status,
        presence,
        seedPresence,
        subscribeChat,
        subscribeEvents,
        sendTyping,
        subscribeCalls,
        sendCall,
        holdConnection,
      }}
    >
      {children}
    </RealtimeContext>
  );
}

export function useRealtime() {
  const context = useContext(RealtimeContext);

  if (!context) {
    throw new Error("useRealtime must be used inside RealtimeProvider");
  }

  return context;
}

export function usePresence(userId: string | undefined): Presence | undefined {
  const { presence } = useRealtime();

  return userId ? presence[userId] : undefined;
}
