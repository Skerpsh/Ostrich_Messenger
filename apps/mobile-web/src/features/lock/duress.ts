import { useMemo, useSyncExternalStore } from "react";
import type { Chat, DisappearStatus, RecoveryPerson, RecoveryStatus, Session } from "@/api/api";
import { newMessageId, randomBytes } from "@/crypto/crypto";
import { getItem, removeItem, setItem } from "@/platform/storage";
import { inDuress, useLock } from "./lock";

// "Head in the sand": opened with the duress PIN (lock.ts), the app shows
// only the chats chosen as safe; the others, Saved messages and new chats
// from other people are not there (chats.tsx filters the list everything
// takes them from). Settings keeps Recovery, If I disappear, Devices and
// App lock, with made-up values (made once, kept here, so they look the
// same each time; changes there only change them). Only on this device;
// optionally a message written ahead goes to a chat of the user's choice
// (the silent alert).

const DURESS_KEY = "ostrich-duress";
const FAKE_KEY = "ostrich-duress-fake";

export type DuressConfig = {
  // The chats shown.
  safe: string[];
  // Sent (encrypted, like any message) when the duress PIN opens the app.
  alert: { chatId: string; text: string } | null;
};

// Times are kept as how long before now, so they stay believable.
type FakeData = {
  recovery: { threshold: number; guardians: RecoveryPerson[]; daysAgo: number } | null;
  disappear: {
    days: number;
    messages: { id: string; chatId: string; content: string; minutesAgo: number }[];
  } | null;
  devices: { id: string; client: string; daysAgo: number; minutesAgo: number }[];
  // App lock as it looks then: no wipe PIN, nothing about this.
  lock: { wipe: boolean; wipeAfterTries: boolean };
};

type DuressState = { config: DuressConfig | null; fake: FakeData | null };

let state: DuressState = { config: null, fake: null };
const listeners = new Set<() => void>();

function set(next: Partial<DuressState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useDuressConfig = () => useSyncExternalStore(subscribe, () => state.config);
export const useFake = () => useSyncExternalStore(subscribe, () => state.fake);

// Opened with the duress PIN: the safe chats' ids; null when not.
export function useDuress() {
  const { duress } = useLock();
  const config = useDuressConfig();

  return useMemo(() => (duress ? new Set(config?.safe ?? []) : null), [duress, config]);
}

function parse<T>(value: string | null): T | null {
  try {
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

export async function loadDuress() {
  const [config, fake] = await Promise.all([getItem(DURESS_KEY), getItem(FAKE_KEY)]);
  set({ config: parse(config), fake: parse(fake) });
}

export async function saveDuressConfig(config: DuressConfig | null) {
  await (config ? setItem(DURESS_KEY, JSON.stringify(config)) : removeItem(DURESS_KEY));
  set({ config });
}

async function saveFake(fake: FakeData | null) {
  await (fake ? setItem(FAKE_KEY, JSON.stringify(fake)) : removeItem(FAKE_KEY));
  set({ fake });
}

export const DURESS_KEYS = [DURESS_KEY, FAKE_KEY];

// A chat started while opened with the duress PIN stays shown then.
export async function showChatInDuress(chatId: string) {
  if (inDuress() && state.config && !state.config.safe.includes(chatId)) {
    await saveDuressConfig({ ...state.config, safe: [...state.config.safe, chatId] });
  }
}

// --- the made-up values ---

const random = (below: number) => randomBytes(1)[0] % below;
const pick = <T>(items: T[]) => items[random(items.length)];

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

// Made when "Head in the sand" is set up, from the safe chats.
export async function makeFakeData(safeChats: Chat[]) {
  const friends: RecoveryPerson[] = safeChats
    .filter((chat) => chat.type === "direct" && chat.user_id && chat.username)
    .map((chat) => ({
      id: chat.user_id!,
      username: chat.username!,
      avatar_id: chat.avatar_id,
      is_developer: chat.is_developer,
    }));
  const guardians = [...friends].sort(() => randomBytes(1)[0] - 128).slice(0, Math.min(friends.length, 2 + random(3)));

  const recovery =
    guardians.length >= 2 && random(2) === 0
      ? { threshold: Math.max(2, Math.floor(guardians.length / 2) + 1), guardians, daysAgo: 7 + random(120) }
      : null;

  const disappear = random(5) < 2 ? { days: pick([30, 90, 180, 365]), messages: [] } : null;

  const devices = Array.from({ length: random(3) }, () => ({
    id: newMessageId(),
    // What the apps really send (the desktop app says "web").
    client: pick(["web", "android", "ios", "cli"]),
    daysAgo: 3 + random(200),
    minutesAgo: 30 + random(10 * 24 * 60),
  }));

  await saveFake({ recovery, disappear, devices, lock: { wipe: false, wipeAfterTries: false } });
}

export async function forgetDuress() {
  await Promise.all([saveDuressConfig(null), saveFake(null)]);
}

// Changes made while opened with the duress PIN.
export async function changeFake(change: (fake: FakeData) => FakeData) {
  if (state.fake) {
    await saveFake(change(state.fake));
  }
}

// Settings → Recovery through friends.
export function fakeRecovery(): RecoveryStatus {
  const recovery = state.fake?.recovery;

  return {
    setup: recovery
      ? {
          id: "00000000-0000-4000-8000-000000000000",
          threshold: recovery.threshold,
          created_at: ago(recovery.daysAgo * DAY),
          guardians: [...recovery.guardians].sort((a, b) => a.username.localeCompare(b.username)),
        }
      : null,
    requests: [],
  };
}

// Settings → If I disappear. Opened just now: the days start again.
export function fakeDisappear(): DisappearStatus {
  const disappear = state.fake?.disappear;

  if (!disappear) {
    return { switch: null, messages: [] };
  }

  const now = Date.now();

  return {
    switch: {
      days: disappear.days,
      last_active_at: new Date(now).toISOString(),
      due_at: new Date(now + disappear.days * DAY).toISOString(),
      warned: 0,
      triggered_at: null,
    },
    messages: disappear.messages.map((message) => ({
      id: message.id,
      chat_id: message.chatId,
      content: message.content,
      attachments: [],
      created_at: ago(message.minutesAgo * MINUTE),
      stale: false,
    })),
  };
}

// Settings → Devices: this one as it is, the others made up.
export function fakeSessions(real: Session[]): Session[] {
  const current = real.filter((session) => session.current);

  return [
    ...current,
    ...(state.fake?.devices ?? []).map((device) => ({
      id: device.id,
      client: device.client,
      created_at: ago(device.daysAgo * DAY),
      last_used_at: ago(device.minutesAgo * MINUTE),
      current: false,
    })),
  ];
}

// "Turn off app lock" while opened with the duress PIN: it looks off until
// the app locks again (it does: the real lock stays).
let lockLooksOff = false;

export const lockSeemsOff = () => inDuress() && lockLooksOff;

export function setLockSeemsOff(off: boolean) {
  lockLooksOff = off;
  listeners.forEach((listener) => listener());
}

export const useLockSeemsOff = () => useSyncExternalStore(subscribe, lockSeemsOff);
