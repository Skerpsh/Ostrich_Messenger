import type { Chat } from "../api/api.ts";

// Stands in for api/local-cache.ts in the tests: the chats cached per user.
export const cachedChats = new Map<string, Chat[]>();

export async function loadCachedChats(userId: string): Promise<Chat[] | null> {
  return cachedChats.get(userId) ?? null;
}
