import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth, useCurrentUser } from "@/features/auth/auth";
import { useAppTheme } from "@/ui/theme";
import { loadAttachment } from "./attachments";
import { cacheGet, cacheSet } from "@/platform/cache";
import type { LookEntry } from "./payload";
import { readChatLook, readWallpaper, type ChatLook, type Wallpaper } from "@/features/settings/personalization";
import { photoUri } from "@/features/settings/wallpaper-photo";
import { isAccentChoice, type AccentChoice } from "@/ui/colors";

// Chats' own looks (accent, wallpaper), kept per account on the device:
// the user's own ones ("for me", synced with settings sync) and the ones
// set for everyone in the chat by a message (features/chat/payload.ts). The user's
// own value of each comes first, then the chat's, then the device-wide one.

// The newest look a member set for everyone; look null: reset.
type SharedLook = { look: ChatLook | null; at: string; messageId: string };

type Stored = {
  mine: Record<string, ChatLook>;
  shared: Record<string, SharedLook>;
};

const EMPTY: Stored = { mine: {}, shared: {} };

type PhotoOf = "mine" | "shared";

// What a chat's screen draws.
export type ResolvedLook = {
  accent: AccentChoice | null;
  wallpaper: Wallpaper;
  // The "photo" wallpaper's picture (null: still loading, or none).
  photo: string | null;
};

type ChatLooksValue = {
  mineOf: (chatId: string) => ChatLook | null;
  sharedOf: (chatId: string) => ChatLook | null;
  photoOf: (chatId: string, of: PhotoOf) => string | null;
  // Loads the chat's photos from the device.
  loadPhotos: (chatId: string) => void;
  // null: back to the chat's / device-wide look. photo: for the "photo" wallpaper.
  setMine: (chatId: string, look: ChatLook | null, photo?: string | null) => void;
  // A look message of the chat (newer ones replace older ones).
  recordShared: (chatId: string, entry: LookEntry, message: { id: string; created_at: string }) => void;
  // Bumped when the user changes their own looks (settings sync).
  revision: number;
  syncedLooks: () => Record<string, ChatLook>;
  applySyncedLooks: (mine: Record<string, ChatLook>) => void;
};

const ChatLooksContext = createContext<ChatLooksValue | null>(null);

export function ChatLooksProvider({ children }: { children: ReactNode }) {
  const { withToken } = useAuth();
  const userId = useCurrentUser()?.id ?? null;
  // Whose looks are loaded: nothing of one account shows in another.
  const [owned, setOwned] = useState<{ owner: string | null; looks: Stored }>({ owner: null, looks: EMPTY });
  const stored = owned.owner === userId ? owned.looks : EMPTY;
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const [revision, setRevision] = useState(0);

  const key = useCallback((...parts: string[]) => [userId, ...parts].join(":"), [userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    cacheGet<Stored>(`${userId}:chat-looks`).then((saved) =>
      setOwned({ owner: userId, looks: { mine: saved?.mine ?? {}, shared: saved?.shared ?? {} } }),
    );
  }, [userId]);

  const save = (update: (current: Stored) => Stored) =>
    setOwned((current) => {
      const next = update(current.owner === userId ? current.looks : EMPTY);
      cacheSet(key("chat-looks"), next);
      return { owner: userId, looks: next };
    });

  const savePhoto = (chatId: string, of: PhotoOf, photo: string | null) => {
    const photoKey = key("chat-photo", chatId, of);
    setPhotos((current) => ({ ...current, [photoKey]: photo }));
    cacheSet(photoKey, photo);
  };

  const loadPhotos = useCallback(
    (chatId: string) => {
      for (const of of ["mine", "shared"] as const) {
        const photoKey = key("chat-photo", chatId, of);

        cacheGet<string>(photoKey).then((photo) =>
          setPhotos((current) => (photoKey in current ? current : { ...current, [photoKey]: photo })),
        );
      }
    },
    [key],
  );

  const recordShared = (chatId: string, entry: LookEntry, message: { id: string; created_at: string }) => {
    const known = stored.shared[chatId];

    if (known && (known.messageId === message.id || known.at >= message.created_at)) {
      return;
    }

    const look = readChatLook({
      accent: entry.accent,
      wallpaper: entry.wallpaper,
    });
    // A photo that is not there is no wallpaper.
    const usable = look?.wallpaper?.pattern === "photo" && !entry.photo ? { ...look, wallpaper: undefined } : look;

    save((current) => ({
      ...current,
      shared: { ...current.shared, [chatId]: { look: usable, at: message.created_at, messageId: message.id } },
    }));

    if (entry.photo && usable?.wallpaper?.pattern === "photo") {
      const { photo } = entry;
      withToken((token) => loadAttachment(token, photo)).then(
        (bytes) => savePhoto(chatId, "shared", photoUri(bytes, photo.mime)),
        () => {},
      );
    } else {
      savePhoto(chatId, "shared", null);
    }
  };

  return (
    <ChatLooksContext
      value={{
        mineOf: (chatId) => stored.mine[chatId] ?? null,
        sharedOf: (chatId) => stored.shared[chatId]?.look ?? null,
        photoOf: (chatId, of) => photos[key("chat-photo", chatId, of)] ?? null,
        loadPhotos,
        setMine: (chatId, look, photo) => {
          save((current) => {
            const mine = { ...current.mine };

            if (look) {
              mine[chatId] = look;
            } else {
              delete mine[chatId];
            }

            return { ...current, mine };
          });

          if (photo !== undefined) {
            savePhoto(chatId, "mine", photo);
          }

          setRevision((r) => r + 1);
        },
        recordShared,
        revision,
        syncedLooks: () => stored.mine,
        applySyncedLooks: (synced) => {
          const mine: Record<string, ChatLook> = {};

          for (const [chatId, value] of Object.entries(synced)) {
            const look = readChatLook(value);

            if (look) {
              mine[chatId] = look;
            }
          }

          save((current) => ({ ...current, mine }));
        },
      }}
    >
      {children}
    </ChatLooksContext>
  );
}

export function useChatLooks() {
  const context = useContext(ChatLooksContext);

  if (!context) {
    throw new Error("useChatLooks must be used inside ChatLooksProvider");
  }

  return context;
}

// What a chat's screen draws: the user's own look, then the chat's, then
// the device-wide one. A "photo" wallpaper without its photo on this device
// (synced from another one) falls through to the next.
export function useChatLook(chatId: string | null): ResolvedLook {
  const looks = useChatLooks();
  const { wallpaper: deviceWallpaper, wallpaperPhoto } = useAppTheme();
  const { loadPhotos } = looks;

  useEffect(() => {
    if (chatId) {
      loadPhotos(chatId);
    }
  }, [chatId, loadPhotos]);

  if (!chatId) {
    return { accent: null, wallpaper: deviceWallpaper, photo: wallpaperPhoto };
  }

  const mine = looks.mineOf(chatId);
  const shared = looks.sharedOf(chatId);
  const minePhoto = looks.photoOf(chatId, "mine");
  const sharedPhoto = looks.photoOf(chatId, "shared");

  const candidates: [Wallpaper | undefined, string | null][] = [
    [mine?.wallpaper, minePhoto],
    [shared?.wallpaper, sharedPhoto],
    [deviceWallpaper, wallpaperPhoto],
  ];

  let wallpaper = deviceWallpaper;
  let photo = wallpaperPhoto;

  for (const [candidate, candidatePhoto] of candidates) {
    const usable = readWallpaper(candidate);

    if (usable && (usable.pattern !== "photo" || candidatePhoto)) {
      wallpaper = usable;
      photo = candidatePhoto;
      break;
    }
  }

  const accent = mine?.accent ?? shared?.accent ?? null;

  return { accent: isAccentChoice(accent) ? accent : null, wallpaper, photo };
}
