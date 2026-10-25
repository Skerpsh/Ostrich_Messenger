import { Platform } from "react-native";
import { API_URL } from "./config";
import type { KeyMaterial } from "@/crypto/crypto";

export type User = {
  id: string;
  username: string;
  // When the username can be changed again; null if it can be now.
  next_username_change_at: string | null;
  // null without a profile picture; see avatarUrl().
  avatar_id: string | null;
  // Shows the DEV badge.
  is_developer: boolean;
  // Privacy: others see when the user is online; read receipts exchanged.
  show_presence: boolean;
  read_receipts: boolean;
};

// Profile pictures are plain image URLs: the id is random and new for
// every upload, so they can be cached for good.
export function avatarUrl(avatarId: string) {
  return `${API_URL}/api/avatars/${encodeURIComponent(avatarId)}`;
}

export type LastMessage = {
  id: string;
  sender_id: string;
  // In the chats list (not for pinned messages).
  sender_username?: string;
  // "system": written by the server about a group (content plain JSON).
  kind?: "text" | "system";
  // Encrypted, whole; clients shorten the decrypted text for previews.
  content: string;
  created_at: string;
};

export type Chat = {
  id: string;
  // "saved": the user's chat with themselves (Saved messages).
  type: "direct" | "group" | "saved";
  created_at: string;
  updated_at: string;
  // Direct chats: the other user (null in groups).
  user_id: string | null;
  username: string | null;
  avatar_id: string | null;
  is_developer: boolean;
  // The other member's public key, to encrypt for them; null until they
  // have set up end-to-end encryption (and in groups).
  public_key: string | null;
  // Groups: the name and photo encrypted with the group key
  // (crypto/crypto.ts), the epoch of the current key (0 in direct chats),
  // whether it needs a new key (someone left), the user's role, how many
  // members.
  encrypted_info: string | null;
  key_epoch: number;
  rotation_needed: boolean;
  role: "owner" | "admin" | "member";
  member_count: number;
  // Groups: unread messages mentioning the user; for admins, people
  // asking to join through the invite link.
  unread_mentions?: number;
  join_requests?: number;
  // Presence of the other user.
  online: boolean;
  last_seen_at: string | null;
  last_message: LastMessage | null;
  // The message pinned at the top of the chat (for both members).
  pinned_message: LastMessage | null;
  // Messages from the other user the signed-in user has not read.
  unread_count: number;
  // Up to when the other user has read the chat (for read receipts).
  peer_last_read_at: string | null;
  // The signed-in user's settings for the chat.
  pinned: boolean;
  muted: boolean;
  // The signed-in user blocked the other member.
  blocked_by_me: boolean;
  // Either has blocked the other: no messages in either direction.
  blocked: boolean;
};

export type ChatHistory = {
  messages: Message[];
  // There are older messages (load them with `before`).
  has_more: boolean;
  // Up to when the signed-in user had read the chat.
  last_read_at: string | null;
  peer_last_read_at: string | null;
};

// The message a reply refers to (its start, for the quote).
export type ReplyPreview = {
  id: string;
  sender_id: string;
  sender_username: string;
  sender_is_developer: boolean;
  content: string;
};

export type Reaction = { emoji: string; user_id: string };

// The emoji messages can be reacted with (same list as the server).
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🙏", "👎"];

export type Message = {
  id: string;
  chat_id: string;
  sender_id: string;
  sender_username: string;
  // "system": written by the server about a group (content plain JSON).
  kind?: "text" | "system";
  content: string;
  created_at: string;
  edited_at: string | null;
  reply_to: ReplyPreview | null;
  reactions: Reaction[];
  // Groups: the members it mentions.
  mentions?: string[];
  // A sealed letter sent as a surprise, not delivered yet: only its
  // sender gets it.
  deliver_at?: string | null;
  // Sent by "If I disappear": the days the sender had not opened Ostrich.
  sent_after_days?: number | null;
};

export type Session = {
  id: string;
  // "web", "ios", "android", "cli", ...
  client: string | null;
  created_at: string;
  last_used_at: string;
  current: boolean;
};

// The account's keys: the private key is encrypted with a key derived
// from the OstrichID (see crypto.ts).
export type AccountKeys = {
  public_key: string;
  encrypted_private_key: string;
};

export type AuthResponse = {
  token: string;
  user: User;
  // Login only.
  keys?: AccountKeys;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    // Machine-readable reason, e.g. "upgrade_required".
    public code?: string,
  ) {
    super(message);
  }
}

// The server rejected the session token: the user has to log in again.
export class SessionExpiredError extends ApiError {
  constructor() {
    super("Session expired, please log in again", 401);
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  options: {
    token?: string;
    body?: unknown;
    // Sent as is instead of JSON, e.g. an image.
    file?: { data: Blob; type: string };
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    // Shown in the list of devices in Settings.
    "X-Ostrich-Client": Platform.OS,
  };

  if (options.file) {
    headers["Content-Type"] = options.file.type;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );

  let response: Response;

  try {
    response = await fetch(API_URL + path, {
      method,
      headers,
      body: options.file
        ? options.file.data
        : options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => null);

  if (response.status === 401 && options.token) {
    throw new SessionExpiredError();
  }

  if (!response.ok) {
    throw new ApiError(
      data?.error ||
        data?.message ||
        `Request failed (HTTP ${response.status})`,
      response.status,
      data?.code,
    );
  }

  return data as T;
}

// --- logging in with a QR code (backend routes/device-links.ts) ---

export type DeviceLink = { id: string; secret: string; expires_at: string };

export function createDeviceLink() {
  return request<DeviceLink>("POST", "/api/device-links", { body: {} });
}

export type DeviceLinkSession =
  | { status: "pending" }
  | (AuthResponse & {
      status: "approved";
      keys: AccountKeys;
      sealed_key: string;
      sealer_public_key: string;
    });

export function deviceLinkSession(id: string, secret: string) {
  return request<DeviceLinkSession>("POST", `/api/device-links/${id}/session`, { body: { secret } });
}

// What kind of device asks, for the device approving it.
export function getDeviceLink(token: string, id: string) {
  return request<{ client: string; created_at: string }>("GET", `/api/device-links/${id}`, { token });
}

export function approveDeviceLink(token: string, id: string, sealed: { sealed: string; publicKey: string }) {
  return request<{ message: string }>("POST", `/api/device-links/${id}/approve`, {
    token,
    body: { sealed_key: sealed.sealed, public_key: sealed.publicKey },
  });
}

// authKey is derived from the OstrichID. Accounts from before end-to-end
// encryption answer 409 "upgrade_required" and are logged in again with
// the raw OstrichID and new keys (upgrade).
export function login(
  username: string,
  password: string,
  authKey: string,
  upgrade?: { ostrichId: string; keys: KeyMaterial },
) {
  return request<AuthResponse>("POST", "/api/auth/login", {
    body: {
      username,
      password,
      auth_key: authKey,
      ...(upgrade
        ? { ostrich_id: upgrade.ostrichId, keys: upgrade.keys }
        : {}),
    },
  });
}

// The OstrichID is generated on the device; only what is derived from it
// is sent.
export function register(username: string, password: string, keys: KeyMaterial) {
  return request<AuthResponse>("POST", "/api/auth/register", {
    body: { username, password, keys },
  });
}

// The account's keys, for a logged-in device that does not have them.
export async function getKeys(token: string) {
  const { keys } = await request<{ keys: AccountKeys }>("GET", "/api/auth/keys", {
    token,
  });

  return keys;
}

// Sets up encryption for an account from before it.
export async function upgradeKeys(
  token: string,
  ostrichId: string,
  keys: KeyMaterial,
) {
  const { keys: stored } = await request<{ keys: AccountKeys }>(
    "POST",
    "/api/auth/keys/upgrade",
    { token, body: { ostrich_id: ostrichId, keys } },
  );

  return stored;
}

export function logout(token: string) {
  return request<unknown>("POST", "/api/auth/logout", { token });
}

// Ends every session of the user, including this one.
export function logoutAll(token: string) {
  return request<unknown>("POST", "/api/auth/logout-all", { token });
}

// Changes the password and ends all other sessions.
export function changePassword(
  token: string,
  currentPassword: string,
  newPassword: string,
) {
  return request<unknown>("POST", "/api/auth/password", {
    token,
    body: { current_password: currentPassword, new_password: newPassword },
  });
}

// Allowed right after registration, then once per 28 days.
export async function changeUsername(
  token: string,
  username: string,
  password: string,
) {
  const { user } = await request<{ user: User }>(
    "POST",
    "/api/auth/username",
    { token, body: { username, password } },
  );

  return user;
}

// Single-use credential for opening the websocket from a browser.
export async function getWsTicket(token: string) {
  const { ticket } = await request<{ ticket: string }>(
    "POST",
    "/api/auth/ws-ticket",
    { token },
  );

  return ticket;
}

// STUN/TURN servers for a call, with a TURN login that expires.
export async function getIceServers(token: string) {
  const { iceServers } = await request<{
    iceServers: { urls: string[]; username?: string; credential?: string }[];
  }>("GET", "/api/calls/ice-servers", { token, timeoutMs: 5_000 });

  return iceServers;
}

export async function getMe(token: string) {
  const { user } = await request<{ user: User }>("GET", "/api/auth/me", {
    token,
  });

  return user;
}

export async function getChats(token: string) {
  const { chats } = await request<{ chats: Chat[] }>("GET", "/api/chats", {
    token,
  });

  return chats;
}

// Opens (or returns the existing) direct chat with the user that has
// exactly this username.
export async function createChat(token: string, username: string) {
  const { chat, user } = await request<{
    chat: { id: string; created_at: string };
    user: {
      id: string;
      username: string;
      avatar_id?: string | null;
      is_developer?: boolean;
      public_key?: string | null;
      online?: boolean;
      last_seen_at?: string | null;
      blocked?: boolean;
    };
  }>("POST", "/api/chats", { token, body: { username } });

  return {
    ...chat,
    type: "direct",
    updated_at: chat.created_at,
    encrypted_info: null,
    key_epoch: 0,
    rotation_needed: false,
    role: "member",
    member_count: 2,
    user_id: user.id,
    username: user.username,
    avatar_id: user.avatar_id ?? null,
    is_developer: user.is_developer ?? false,
    public_key: user.public_key ?? null,
    online: user.online ?? false,
    last_seen_at: user.last_seen_at ?? null,
    last_message: null,
    pinned_message: null,
    unread_count: 0,
    peer_last_read_at: null,
    pinned: false,
    muted: false,
    blocked_by_me: false,
    blocked: user.blocked ?? false,
  } satisfies Chat;
}

// The newest messages, or those before the message `before`.
export function getMessages(token: string, chatId: string, before?: string) {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";

  return request<ChatHistory>(
    "GET",
    `/api/chats/${encodeURIComponent(chatId)}/messages${query}`,
    { token },
  );
}

const messagePath = (chatId: string, messageId: string) =>
  `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`;

// Own messages only; `content` is encrypted.
export async function editMessage(
  token: string,
  chatId: string,
  messageId: string,
  content: string,
) {
  const { message } = await request<{ message: Message }>(
    "PATCH",
    messagePath(chatId, messageId),
    { token, body: { content } },
  );

  return message;
}

// Own messages, for everyone.
export function deleteMessage(token: string, chatId: string, messageId: string) {
  return request<unknown>("DELETE", messagePath(chatId, messageId), { token });
}

// "If I disappear" (features/disappear): messages sent for the user when
// they have not opened Ostrich for `days` days.
export type DisappearStatus = {
  switch: {
    days: number;
    last_active_at: string;
    // When it goes off; null once it has.
    due_at: string | null;
    // Warnings sent: 1 a week before, 2 a day before, 3 an hour before.
    warned: number;
    triggered_at: string | null;
  } | null;
  messages: {
    id: string;
    chat_id: string;
    // Encrypted for the chat, like any message.
    content: string;
    attachments: string[];
    created_at: string;
    // Not sendable as it is (left the chat, the group's key changed).
    stale: boolean;
  }[];
};

export function getDisappear(token: string) {
  return request<DisappearStatus>("GET", "/api/disappear", { token });
}

// On, or a new period: the days start again.
export function setDisappear(token: string, days: number) {
  return request<DisappearStatus>("PUT", "/api/disappear", { token, body: { days } });
}

export function turnOffDisappear(token: string) {
  return request<DisappearStatus>("DELETE", "/api/disappear", { token });
}

// "I'm here": sent when the app is opened.
// `was_warned`: the warning sent before it (1–3), or 0.
export function disappearAlive(token: string) {
  return request<DisappearStatus & { was_warned: number }>("POST", "/api/disappear/alive", { token });
}

export function saveDisappearMessage(
  token: string,
  message: { id: string; chatId: string; content: string; attachments: string[] },
) {
  return request<DisappearStatus>("PUT", `/api/disappear/messages/${encodeURIComponent(message.id)}`, {
    token,
    body: { chat_id: message.chatId, content: message.content, attachments: message.attachments },
  });
}

export function deleteDisappearMessage(token: string, id: string) {
  return request<DisappearStatus>("DELETE", `/api/disappear/messages/${encodeURIComponent(id)}`, { token });
}

// --- recovery through friends (backend recovery.ts, features/recovery) ---

export type RecoveryPerson = { id: string; username: string; avatar_id: string | null; is_developer: boolean };

// A request to recover the account from a new device.
export type RecoveryRequest = {
  id: string;
  // The new device's one-time key: its code is compared with the guardians.
  public_key: string;
  client: string;
  created_at: string;
  // The shares are given out after this (if not cancelled).
  ready_at: string;
  expires_at: string;
  approvals: number;
};

export type RecoveryStatus = {
  setup: { id: string; threshold: number; created_at: string; guardians: RecoveryPerson[] } | null;
  requests: RecoveryRequest[];
};

export function getRecovery(token: string) {
  return request<RecoveryStatus>("GET", "/api/recovery", { token });
}

// The guardians, replacing any before: each share sealed for its guardian.
// `authKey`: of the OstrichID they are shares of.
export function setRecovery(
  token: string,
  setup: {
    id: string;
    threshold: number;
    authKey: string;
    shares: { guardian_id: string; sealed: string; sealer_public: string }[];
  },
) {
  return request<RecoveryStatus>("PUT", "/api/recovery", {
    token,
    body: { id: setup.id, threshold: setup.threshold, auth_key: setup.authKey, shares: setup.shares },
  });
}

export function removeRecovery(token: string) {
  return request<RecoveryStatus>("DELETE", "/api/recovery", { token });
}

// "It's not me."
export function cancelRecoveryRequest(token: string, id: string) {
  return request<RecoveryStatus>("DELETE", `/api/recovery/requests/${encodeURIComponent(id)}`, { token });
}

// The friends whose shares the user keeps.
export type Guarding = {
  setup_id: string;
  threshold: number;
  total: number;
  // The share, sealed for the user.
  sealed: string;
  sealer_public: string;
  owner: RecoveryPerson;
  request: {
    id: string;
    public_key: string;
    client: string;
    created_at: string;
    ready_at: string;
    approved: boolean;
  } | null;
};

export async function getGuarding(token: string) {
  const { guarding } = await request<{ guarding: Guarding[] }>("GET", "/api/recovery/guarding", { token });

  return guarding;
}

// The guardian's share, sealed again for the request's key.
export function approveRecovery(token: string, requestId: string, sealed: { sealed: string; publicKey: string }) {
  return request<{ approved: true }>("POST", `/api/recovery/requests/${encodeURIComponent(requestId)}/approve`, {
    token,
    body: { sealed: sealed.sealed, sealer_public: sealed.publicKey },
  });
}

// Logged out: asks to recover, with a one-time public key. `secret`
// fetches the shares later. "no_guardians" (404) if there are none.
export type NewRecoveryRequest = {
  id: string;
  secret: string;
  user_id: string;
  username: string;
  ready_at: string;
  expires_at: string;
  threshold: number;
  total: number;
};

export function requestRecovery(username: string, password: string, publicKey: string) {
  return request<NewRecoveryRequest>("POST", "/api/recovery/requests", {
    body: { username, password, public_key: publicKey },
  });
}

export type RecoveryProgress = {
  state: "waiting" | "ready" | "cancelled" | "completed" | "expired";
  ready_at: string;
  expires_at: string;
  approvals: number;
  threshold: number | null;
  total: number | null;
  // Once ready: each a share sealed for the request's key.
  shares?: { guardian_id: string; sealed: string; sealer_public: string }[];
  encrypted_private_key?: string;
};

export function recoveryProgress(id: string, secret: string) {
  return request<RecoveryProgress>("POST", `/api/recovery/requests/${encodeURIComponent(id)}/status`, {
    body: { secret },
  });
}

// A new OstrichID for the same key pair; ends the guardians' setup (its
// shares were of the old one). `recovered`: after a recovery through
// friends, which also ended every other session.
export function changeOstrichId(token: string, password: string, authKey: string, keys: KeyMaterial) {
  return request<{ keys: AccountKeys; recovered: boolean }>("POST", "/api/auth/ostrich-id", {
    token,
    body: { password, auth_key: authKey, keys },
  });
}

// A drand round's signature, the key of the letters sealed to it
// (features/chat/sealed.ts checks it); refused (425) before the round.
export async function getDrandSignature(token: string, round: number) {
  const { signature } = await request<{ round: number; signature: string }>(
    "GET",
    `/api/drand/rounds/${encodeURIComponent(String(round))}`,
    { token },
  );

  return signature;
}

// "What the server sees": the database's rows as they are stored.
export type MessageServerView = {
  message: {
    id: string;
    chat_id: string;
    sender_id: string;
    sender_username: string;
    kind: "text" | "system";
    content: string;
    content_length: number;
    reply_to_id: string | null;
    created_at: string;
    edited_at: string | null;
    // A surprise not delivered yet (only its sender sees this).
    deliver_at: string | null;
  };
  attachments: { id: string; size: number; created_at: string }[];
  reactions: { emoji: string; user_id: string; created_at: string }[];
  mentions: string[];
};

export function getMessageServerView(token: string, chatId: string, messageId: string) {
  return request<MessageServerView>("GET", `${messagePath(chatId, messageId)}/server-view`, { token });
}

export type ChatServerView = {
  chat: {
    id: string;
    type: "direct" | "group" | "saved";
    created_at: string;
    updated_at: string;
    encrypted_info: string | null;
    key_epoch: number;
    pinned_message_id: string | null;
  };
  members: { user_id: string; username: string; role: string; joined_at: string }[];
  // The user's own row: read position and settings in the chat.
  me: {
    joined_at: string;
    last_read_at: string;
    pinned_at: string | null;
    muted: boolean;
    hidden: boolean;
    cleared_at: string | null;
    role: string;
  };
  stats: {
    messages: number;
    files: number;
    file_bytes: number;
    group_keys: number;
    invite_link: boolean;
    join_requests: number;
  };
};

export function getChatServerView(token: string, chatId: string) {
  return request<ChatServerView>("GET", `/api/chats/${encodeURIComponent(chatId)}/server-view`, { token });
}

// null removes the user's reaction.
export async function setReaction(
  token: string,
  chatId: string,
  messageId: string,
  emoji: string | null,
) {
  const { reactions } = await request<{ reactions: Reaction[] }>(
    "PUT",
    `${messagePath(chatId, messageId)}/reaction`,
    { token, body: { emoji } },
  );

  return reactions;
}

export function setChatSettings(
  token: string,
  chatId: string,
  settings: { pinned?: boolean; muted?: boolean },
) {
  return request<{ pinned: boolean; muted: boolean }>(
    "PUT",
    `/api/chats/${encodeURIComponent(chatId)}/settings`,
    { token, body: settings },
  );
}

// "everyone": for both members, with all messages. "me": clears the
// history for the signed-in user only.
export function deleteChat(token: string, chatId: string, scope: "everyone" | "me") {
  return request<unknown>(
    "DELETE",
    `/api/chats/${encodeURIComponent(chatId)}?for=${scope}`,
    { token },
  );
}

// Pins a message at the top of the chat for both members; null unpins.
export async function setPinnedMessage(token: string, chatId: string, messageId: string | null) {
  const { message } = await request<{ message: LastMessage | null }>(
    "PUT",
    `/api/chats/${encodeURIComponent(chatId)}/pinned-message`,
    { token, body: { message_id: messageId } },
  );

  return message;
}

export function setBlocked(token: string, userId: string, blocked: boolean) {
  return request<unknown>(
    blocked ? "PUT" : "DELETE",
    `/api/users/${encodeURIComponent(userId)}/block`,
    { token },
  );
}

export async function setPrivacy(
  token: string,
  privacy: { show_presence?: boolean; read_receipts?: boolean },
) {
  const { user } = await request<{ user: User }>("PUT", "/api/auth/privacy", {
    token,
    body: privacy,
  });

  return user;
}

export async function getSessions(token: string) {
  const { sessions } = await request<{ sessions: Session[] }>(
    "GET",
    "/api/auth/sessions",
    { token },
  );

  return sessions;
}

export function endSession(token: string, sessionId: string) {
  return request<unknown>(
    "DELETE",
    `/api/auth/sessions/${encodeURIComponent(sessionId)}`,
    { token },
  );
}

// Needs the password and the auth key derived from the OstrichID.
export function deleteAccount(token: string, password: string, authKey: string) {
  return request<unknown>("POST", "/api/auth/delete-account", {
    token,
    body: { password, auth_key: authKey },
  });
}

// Push notifications (mobile apps).
export function savePushToken(token: string, pushToken: string) {
  return request<unknown>("PUT", "/api/push/token", {
    token,
    body: { token: pushToken },
  });
}

export function removePushToken(token: string) {
  return request<unknown>("DELETE", "/api/push/token", { token });
}

// Settings synced between the user's devices, encrypted (lib/settings-sync.ts).
export type SyncedSettings = { data: string; updated_at: string };

export async function getSettings(token: string) {
  const { settings } = await request<{ settings: SyncedSettings | null }>("GET", "/api/settings", { token });
  return settings;
}

export function saveSettings(token: string, data: string) {
  return request<{ updated_at: string }>("PUT", "/api/settings", { token, body: { data } });
}

// Marks the chat read up to and including the message.
export function markRead(token: string, chatId: string, messageId: string) {
  return request<{ last_read_at: string }>(
    "POST",
    `/api/chats/${encodeURIComponent(chatId)}/read`,
    { token, body: { message_id: messageId } },
  );
}

// `id` is chosen by the client (newMessageId()): the encrypted content is
// bound to it.
export async function sendMessage(
  token: string,
  chatId: string,
  message: {
    id: string;
    content: string;
    // Id of the message this one replies to.
    replyTo: string | null;
    // Ids of the encrypted files uploaded for it.
    attachments?: string[];
    // Groups: members it mentions.
    mentions?: string[];
    // A sealed letter sent as a surprise: kept from the others until then
    // (ISO time).
    deliverAt?: string;
  },
) {
  const { message: sent } = await request<{ message: Message }>(
    "POST",
    `/api/chats/${encodeURIComponent(chatId)}/messages`,
    {
      token,
      body: {
        id: message.id,
        content: message.content,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
        ...(message.mentions?.length ? { mentions: message.mentions } : {}),
        ...(message.deliverAt ? { deliver_at: message.deliverAt } : {}),
      },
    },
  );

  return sent;
}

// The user's Saved messages chat (made the first time); its id.
export async function openSavedChat(token: string) {
  const { chat } = await request<{ chat: { id: string } }>("POST", "/api/chats/saved", { token });
  return chat.id;
}

// --- groups (encrypted on the client, see crypto/crypto.ts and
// context/groups.tsx) ---

// A user found by @username, with their public key (to wrap a group key
// for them).
export type FoundUser = {
  id: string;
  username: string;
  public_key: string | null;
  avatar_id: string | null;
  is_developer: boolean;
};

export async function findUser(token: string, username: string) {
  const { user } = await request<{ user: FoundUser }>(
    "GET",
    `/api/users/by-username/${encodeURIComponent(username)}`,
    { token },
  );

  return user;
}

export type MemberKey = { user_id: string; wrapped_key: string };

export function createGroup(
  token: string,
  group: { id: string; encrypted_info: string; keys: MemberKey[] },
) {
  return request<unknown>("POST", "/api/groups", { token, body: group });
}

export type GroupMember = FoundUser & {
  role: "owner" | "admin" | "member";
  joined_at: string;
};

export async function getGroupMembers(token: string, chatId: string) {
  const { members } = await request<{ members: GroupMember[] }>(
    "GET",
    `/api/chats/${encodeURIComponent(chatId)}/members`,
    { token },
  );

  return members;
}

// The group's keys wrapped for this user: every epoch they were given (older ones are passed on by other members, features/groups/groups.ts).
export type WrappedGroupKey = {
  epoch: number;
  wrapped_key: string;
  // Who wrapped it (null once their account is gone) and their key.
  wrapper_id: string | null;
  wrapper_public_key: string;
};

// Which of this user's epochs other members lack, to wrap for them.
export async function getMissingGroupKeys(token: string, chatId: string) {
  const { members } = await request<{ members: { user_id: string; public_key: string; epochs: number[] }[] }>(
    "GET",
    `/api/chats/${encodeURIComponent(chatId)}/keys/missing`,
    { token },
  );

  return members;
}

export function shareGroupKeys(token: string, chatId: string, keys: { user_id: string; epoch: number; wrapped_key: string }[]) {
  return request<{ shared: number }>("POST", `/api/chats/${encodeURIComponent(chatId)}/keys/share`, {
    token,
    body: { keys },
  });
}

export async function getGroupKeys(token: string, chatId: string) {
  const { keys } = await request<{ keys: WrappedGroupKey[] }>(
    "GET",
    `/api/chats/${encodeURIComponent(chatId)}/keys`,
    { token },
  );

  return keys;
}

export function addGroupMember(
  token: string,
  chatId: string,
  member: { user_id: string; wrapped_key: string; epoch: number },
) {
  return request<unknown>("POST", `/api/chats/${encodeURIComponent(chatId)}/members`, {
    token,
    body: member,
  });
}

// The next key comes with removing someone else; leaving needs none.
export type GroupRotation = { epoch: number; keys: MemberKey[]; encrypted_info: string };

export function removeGroupMember(
  token: string,
  chatId: string,
  userId: string,
  rotation?: GroupRotation,
) {
  return request<unknown>(
    "DELETE",
    `/api/chats/${encodeURIComponent(chatId)}/members/${encodeURIComponent(userId)}`,
    { token, ...(rotation ? { body: rotation } : {}) },
  );
}

export function setGroupRole(token: string, chatId: string, userId: string, role: "admin" | "member") {
  return request<unknown>(
    "PUT",
    `/api/chats/${encodeURIComponent(chatId)}/members/${encodeURIComponent(userId)}/role`,
    { token, body: { role } },
  );
}

// photo_id: a new photo (uploaded as an attachment), null to remove it,
// left out to keep it.
export function setGroupInfo(
  token: string,
  chatId: string,
  info: { encrypted_info: string; photo_id?: string | null },
) {
  return request<unknown>("PUT", `/api/chats/${encodeURIComponent(chatId)}/info`, {
    token,
    body: info,
  });
}

export function rotateGroupKey(token: string, chatId: string, rotation: GroupRotation) {
  return request<unknown>("POST", `/api/chats/${encodeURIComponent(chatId)}/keys`, {
    token,
    body: rotation,
  });
}

// --- invite links: opening one asks to join, an admin lets people in ---

export async function getInvite(token: string, chatId: string) {
  const { token: invite } = await request<{ token: string | null }>(
    "GET",
    `/api/chats/${encodeURIComponent(chatId)}/invite`,
    { token },
  );

  return invite;
}

// A new link (the old one stops working).
export async function makeInvite(token: string, chatId: string) {
  const { token: invite } = await request<{ token: string }>(
    "PUT",
    `/api/chats/${encodeURIComponent(chatId)}/invite`,
    { token },
  );

  return invite;
}

export function removeInvite(token: string, chatId: string) {
  return request<unknown>("DELETE", `/api/chats/${encodeURIComponent(chatId)}/invite`, { token });
}

export type InviteInfo = {
  // Only once the user is a member.
  chat_id: string | null;
  invited_by: string | null;
  member_count: number;
  status: "member" | "requested" | "none";
};

export async function getInviteInfo(token: string, invite: string) {
  const { invite: info } = await request<{ invite: InviteInfo }>(
    "GET",
    `/api/invites/${encodeURIComponent(invite)}`,
    { token },
  );

  return info;
}

export function requestToJoin(token: string, invite: string) {
  return request<unknown>("POST", `/api/invites/${encodeURIComponent(invite)}/request`, { token });
}

export function cancelJoinRequest(token: string, invite: string) {
  return request<unknown>("DELETE", `/api/invites/${encodeURIComponent(invite)}/request`, { token });
}

export type JoinRequest = FoundUser & { created_at: string };

export async function getJoinRequests(token: string, chatId: string) {
  const { requests } = await request<{ requests: JoinRequest[] }>(
    "GET",
    `/api/chats/${encodeURIComponent(chatId)}/requests`,
    { token },
  );

  return requests;
}

export function declineJoinRequest(token: string, chatId: string, userId: string) {
  return request<unknown>(
    "DELETE",
    `/api/chats/${encodeURIComponent(chatId)}/requests/${encodeURIComponent(userId)}`,
    { token },
  );
}

// --- attachments (encrypted on the client, see features/chat/attachments.ts) ---

const attachmentPath = (id: string) => `/api/attachments/${encodeURIComponent(id)}`;

// Uploads an encrypted file under the id the client chose (web; the apps
// upload from a file, see platform/files.ts).
// Copies an attachment the user can read under a new id (forwarding).
export function copyAttachment(token: string, id: string, newId: string) {
  return request<unknown>("POST", `${attachmentPath(id)}/copy`, { token, body: { id: newId } });
}

// Downloads an encrypted file (web).
export async function getAttachmentBytes(token: string, id: string): Promise<Uint8Array> {
  let response: Response;

  try {
    response = await fetch(API_URL + attachmentPath(id), {
      headers: { Authorization: `Bearer ${token}`, "X-Ostrich-Client": Platform.OS },
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }

  if (response.status === 401) {
    throw new SessionExpiredError();
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(data?.error || `Request failed (HTTP ${response.status})`, response.status);
  }

  return new Uint8Array(await response.arrayBuffer());
}

// Sets the profile picture (the server re-encodes it to a square WebP).
export async function uploadAvatar(token: string, image: Blob) {
  const { user } = await request<{ user: User }>(
    "PUT",
    "/api/users/me/avatar",
    {
      token,
      file: { data: image, type: image.type || "image/jpeg" },
      timeoutMs: 60_000,
    },
  );

  return user;
}

export async function removeAvatar(token: string) {
  const { user } = await request<{ user: User }>(
    "DELETE",
    "/api/users/me/avatar",
    { token },
  );

  return user;
}
