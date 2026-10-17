import { Platform } from "react-native";
import { API_URL } from "./config";
import { getItem, removeItem, setItem } from "./storage";

// Links into Ostrich: an invite to a group, a user's profile; and what a
// scanned QR code says (one of those, or a safety code).

// Where the web app is: this page on the web; set for the apps
// (EXPO_PUBLIC_WEB_URL), the API's address otherwise.
export const WEB_URL = (
  process.env.EXPO_PUBLIC_WEB_URL ||
  (Platform.OS === "web" && typeof location !== "undefined" ? location.origin : API_URL)
).replace(/\/+$/, "");

export const inviteLink = (token: string) => `${WEB_URL}/chats/join/${token}`;

export const profileLink = (username: string) => `${WEB_URL}/chats/u/${encodeURIComponent(username)}`;

const SAFETY_PREFIX = "ostrich-safety:";
const LOGIN_PREFIX = "ostrich-login:";

// The text of the QR code a new device shows to be logged in
// (app/link-device.tsx): the link's id and the device's one-time key.
export const loginQr = (id: string, publicKey: string) => `${LOGIN_PREFIX}${id}:${publicKey}`;

// The text of a safety code's QR code.
export const safetyQr = (code: string[]) => SAFETY_PREFIX + code.join("");

export type ScannedLink =
  | { kind: "join"; token: string }
  | { kind: "user"; username: string }
  | { kind: "safety"; code: string }
  | { kind: "login"; id: string; publicKey: string };

export function parseLink(text: string): ScannedLink | null {
  const value = text.trim();

  if (value.startsWith(SAFETY_PREFIX)) {
    const code = value.slice(SAFETY_PREFIX.length);
    return /^\d{40}$/.test(code) ? { kind: "safety", code } : null;
  }

  if (value.startsWith(LOGIN_PREFIX)) {
    const login = /^([0-9a-f-]{36}):([A-Za-z0-9+/]{43}=)$/.exec(value.slice(LOGIN_PREFIX.length));
    return login ? { kind: "login", id: login[1], publicKey: login[2] } : null;
  }

  // Any address ending in /chats/join/… or /chats/u/… (also another
  // device's web address).
  const join = /\/chats\/join\/([A-Za-z0-9_-]{16,64})\/?$/.exec(value);

  if (join) {
    return { kind: "join", token: join[1] };
  }

  const user = /\/chats\/u\/([A-Za-z0-9_.-]{3,32})\/?$/.exec(value);

  if (user) {
    return { kind: "user", username: decodeURIComponent(user[1]) };
  }

  return null;
}

// The path of a link, to open it in the app.
export function linkPath(link: ScannedLink) {
  return link.kind === "join"
    ? `/chats/join/${link.token}`
    : link.kind === "user"
      ? `/chats/u/${link.username}`
      : null;
}

// A link opened while logged out is kept and opened after logging in.
const PENDING_KEY = "ostrich-pending-link";

export function rememberLink(path: string) {
  return setItem(PENDING_KEY, path);
}

export async function takePendingLink() {
  const path = await getItem(PENDING_KEY);

  if (path) {
    await removeItem(PENDING_KEY);
  }

  return path && /^\/chats\/(join|u)\/[^/]+$/.test(path) ? path : null;
}
