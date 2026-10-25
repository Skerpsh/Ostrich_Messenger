import { useSyncExternalStore } from "react";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { fromBase64, randomBytes, toBase64, toHex } from "@/crypto/crypto";
import { getItem, removeItem, setItem } from "@/platform/storage";

// App lock: a 4-digit PIN asked when the app starts and, as chosen, after
// it was in the background. Only on this device: the PIN is kept as a
// slow hash (scrypt), never sent nor synced. A wipe PIN, and optionally 10
// wrong PINs in a row, wipe the device instead (features/lock/wipe.ts).
//
// The PIN locks the screens, it does not encrypt anything: 10 000 PINs are
// tried in minutes on a computer. What protects is the waiting between
// wrong PINs and the wipe.

export const PIN_LENGTH = 4;

const CONFIG_KEY = "ostrich-app-lock";
// Kept apart, so that restarting the app does not reset the waiting.
const FAILURES_KEY = "ostrich-app-lock-failures";

// The hash of the PIN costs about 0.1 s on a computer, more on a phone.
const SCRYPT = { N: 2 ** 13, r: 8, p: 1, dkLen: 32 };

export type LockConfig = {
  // One salt for all the PINs, so a PIN typed is hashed once.
  salt: string;
  pin: string;
  wipe: string | null;
  wipeAfterTries: boolean;
  // Minutes in the background before it locks; null: only at start.
  background: number | null;
};

type Failures = { count: number; until: number };

export const WIPE_AFTER = 10;

// After the 5th wrong PIN in a row, the next waits; then longer.
const WAIT_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

function waitAfter(count: number) {
  return count < 5 ? 0 : WAIT_MS[Math.min(count - 5, WAIT_MS.length - 1)];
}

type LockState = {
  loaded: boolean;
  config: LockConfig | null;
  locked: boolean;
  failures: Failures;
};

let state: LockState = { loaded: false, config: null, locked: false, failures: { count: 0, until: 0 } };
const listeners = new Set<() => void>();

function set(next: Partial<LockState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useLock = () => useSyncExternalStore(subscribe, () => state);

function parse<T>(value: string | null): T | null {
  try {
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

// At start: locked if there is a PIN.
export async function loadLock() {
  const [config, failures] = await Promise.all([getItem(CONFIG_KEY), getItem(FAILURES_KEY)]);
  const parsed = parse<LockConfig>(config);

  set({
    loaded: true,
    config: parsed,
    locked: parsed !== null,
    failures: parse<Failures>(failures) ?? { count: 0, until: 0 },
  });
}

async function hashPin(pin: string, salt: string) {
  return toHex(await scryptAsync(pin, fromBase64(salt), SCRYPT));
}

// Compares hex hashes without stopping at the first difference.
function same(a: string, b: string | null) {
  if (b === null || a.length !== b.length) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}

async function saveConfig(config: LockConfig | null) {
  if (config) {
    await setItem(CONFIG_KEY, JSON.stringify(config));
  } else {
    await removeItem(CONFIG_KEY);
  }

  set({ config });
}

async function saveFailures(failures: Failures) {
  await setItem(FAILURES_KEY, JSON.stringify(failures));
  set({ failures });
}

export const validPin = (pin: string) => new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);

// What a PIN typed at the lock screen is.
export type PinResult =
  | { kind: "unlock" }
  | { kind: "wipe" }
  | { kind: "wrong"; failures: number; waitUntil: number }
  | { kind: "wait"; waitUntil: number };

export async function enterPin(pin: string): Promise<PinResult> {
  const config = state.config;

  if (!config) {
    return { kind: "unlock" };
  }

  const hash = await hashPin(pin, config.salt);

  // While waiting only the wipe PIN works (a wrong PIN does not count).
  if (state.failures.until > Date.now()) {
    return same(hash, config.wipe) ? { kind: "wipe" } : { kind: "wait", waitUntil: state.failures.until };
  }

  if (same(hash, config.pin)) {
    await saveFailures({ count: 0, until: 0 });
    set({ locked: false });
    return { kind: "unlock" };
  }

  if (same(hash, config.wipe)) {
    return { kind: "wipe" };
  }

  const count = state.failures.count + 1;

  if (config.wipeAfterTries && count >= WIPE_AFTER) {
    return { kind: "wipe" };
  }

  const waitUntil = Date.now() + waitAfter(count);
  await saveFailures({ count, until: waitUntil });

  return { kind: "wrong", failures: count, waitUntil };
}

// Whether a PIN is the app lock's own one (for the settings).
export async function isPin(pin: string) {
  return state.config !== null && same(await hashPin(pin, state.config.salt), state.config.pin);
}

export async function turnOnLock(pin: string) {
  const salt = toBase64(randomBytes(16));

  await saveFailures({ count: 0, until: 0 });
  await saveConfig({ salt, pin: await hashPin(pin, salt), wipe: null, wipeAfterTries: false, background: 1 });
}

export const turnOffLock = async () => {
  await Promise.all([saveConfig(null), removeItem(FAILURES_KEY)]);
  set({ locked: false, failures: { count: 0, until: 0 } });
};

// A new PIN; the wipe PIN cannot be the same.
export async function changePin(pin: string) {
  const config = state.config!;
  const hash = await hashPin(pin, config.salt);

  if (same(hash, config.wipe)) {
    throw new Error("This is your wipe PIN: choose another one");
  }

  await saveConfig({ ...config, pin: hash });
}

// null: no wipe PIN.
export async function setWipePin(pin: string | null) {
  const config = state.config!;

  if (pin === null) {
    await saveConfig({ ...config, wipe: null });
    return;
  }

  const hash = await hashPin(pin, config.salt);

  if (same(hash, config.pin)) {
    throw new Error("The wipe PIN must be different from your PIN");
  }

  await saveConfig({ ...config, wipe: hash });
}

export const setWipeAfterTries = (on: boolean) => saveConfig({ ...state.config!, wipeAfterTries: on });

export const setBackgroundLock = (minutes: number | null) => saveConfig({ ...state.config!, background: minutes });

export function lockNow() {
  if (state.config) {
    set({ locked: true });
  }
}

// What the app lock keeps on the device (removed with the account's data).
export const LOCK_KEYS = [CONFIG_KEY, FAILURES_KEY];

// Logged out or wiped: no lock any more.
export function forgetLock() {
  set({ config: null, locked: false, failures: { count: 0, until: 0 } });
}
