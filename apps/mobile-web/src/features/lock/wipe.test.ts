/// <reference types="node" />
// npm test. Wiping the device leaves nothing of Ostrich's behind (on an
// in-memory storage that, like the Keychain, removes only the keys named).
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { Chat } from "../../api/api.ts";
import "../../test/modules.ts";
import { cleared } from "../../test/cache.ts";
import { cachedChats } from "../../test/local-cache.ts";
import { stored } from "../../test/storage.ts";

const lock = await import("./lock.ts");
const duress = await import("./duress.ts");
const { wipeLocalData } = await import("./wipe.ts");

const FIXED = [
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
];

const chat = (id: string, userId: string | null) => ({ id, user_id: userId }) as Chat;

beforeEach(() => {
  stored.clear();
  cachedChats.clear();
  cleared.length = 0;
});

test("the fixed keys, the app lock and Head in the sand go", async () => {
  FIXED.forEach((key) => stored.set(key, "x"));
  await lock.turnOnLock("1234");
  await lock.setDuressPin("5555");
  await duress.saveDuressConfig({ safe: ["a"], alert: null });
  await duress.makeFakeData([]);
  stored.set("not-ostrich", "kept");

  await wipeLocalData(null);

  assert.deepEqual([...stored.keys()], ["not-ostrich"]);
  assert.deepEqual(cleared, [""]);
});

test("after a wipe the app starts unlocked, as freshly installed", async () => {
  await lock.turnOnLock("1234");
  await wipeLocalData(null);
  lock.forgetLock();

  await lock.loadLock();
  await duress.loadDuress();

  assert.equal(lock.useLock().locked, false);
  assert.equal(lock.useLock().config, null);
  assert.equal(duress.useDuressConfig(), null);
});

test("the user's drafts and contacts' keys go, by the chats known here", async () => {
  cachedChats.set("me", [chat("c1", "bob"), chat("group", null)]);
  const mine = [
    "ostrich-drafts-me",
    "ostrich-draft-me-c1",
    "ostrich-draft-me-group",
    // A draft in a chat no longer cached, listed with the drafts.
    "ostrich-draft-me-old",
    "ostrich-peer-key-me-bob",
  ];
  mine.forEach((key) => stored.set(key, "x"));
  stored.set("ostrich-drafts-me", JSON.stringify(["c1", "old"]));
  // Another account's are not named, so they stay.
  stored.set("ostrich-draft-you-c1", "x");

  await wipeLocalData("me");

  assert.deepEqual([...stored.keys()], ["ostrich-draft-you-c1"]);
});

test("damaged drafts or no cached chats do not stop the wipe", async () => {
  stored.set("ostrich-drafts-me", "{not json");
  stored.set("ostrich-token", "x");

  await wipeLocalData("me");

  assert.equal(stored.size, 0);
  assert.deepEqual(cleared, [""]);
});
