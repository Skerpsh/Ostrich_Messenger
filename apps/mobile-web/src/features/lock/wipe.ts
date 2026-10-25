import { loadCachedChats } from "@/api/local-cache";
import { cacheClear } from "@/platform/cache";
import { getItem, removeItems } from "@/platform/storage";
import { LOCK_KEYS } from "./lock";

// Wiping the device (the wipe PIN, 10 wrong PINs, "Forgot your PIN?"):
// everything Ostrich keeps here goes, so it looks freshly installed. The
// session is ended on the server first (features/auth/auth.tsx
// wipeDevice); the account and its messages stay there.

// What the app keeps by fixed names (see the modules that keep them).
const KEYS = [
  "ostrich-token",
  "ostrich-user",
  "ostrich-private-key",
  "ostrich-pending-id",
  "ostrich-theme",
  "ostrich-accent",
  "ostrich-personalization",
  "ostrich-app-icon",
  "ostrich-notifications",
  "ostrich-notification-previews",
  "ostrich-pending-link",
  "ostrich-call-layout",
  "ostrich-recent-emoji",
  "ostrich-recovery-request",
  "ostrich-recovered",
  ...LOCK_KEYS,
];

export async function wipeLocalData(userId: string | null) {
  const keys = [...KEYS];

  if (userId) {
    // The contacts' keys remembered (crypto/known-keys.ts) and the drafts
    // (features/chats/chats.tsx), by the chats known here.
    const [chats, drafts] = await Promise.all([
      loadCachedChats(userId).catch(() => null),
      getItem(`ostrich-drafts-${userId}`).catch(() => null),
    ]);

    for (const chat of chats ?? []) {
      keys.push(`ostrich-draft-${userId}-${chat.id}`);

      if (chat.user_id) {
        keys.push(`ostrich-peer-key-${userId}-${chat.user_id}`);
      }
    }

    try {
      for (const chatId of JSON.parse(drafts ?? "[]") as string[]) {
        keys.push(`ostrich-draft-${userId}-${chatId}`);
      }
    } catch {}

    keys.push(`ostrich-drafts-${userId}`);
  }

  // The chats, messages and outbox of every account.
  await cacheClear("");
  await removeItems(keys);
}
