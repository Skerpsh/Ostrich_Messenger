/// <reference types="node" />
// npm test. "Head in the sand": what shows when the app is opened with the
// duress PIN, and the made-up settings, on an in-memory storage (src/test/).
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import type { Chat, Session } from "../../api/api.ts";
import "../../test/modules.ts";
import { stored } from "../../test/storage.ts";

const lock = await import("./lock.ts");
const duress = await import("./duress.ts");

const PIN = "1234";
const DURESS = "5555";
const DAY = 24 * 60 * 60_000;

const chat = (id: string, more: Partial<Chat> = {}) =>
  ({
    id,
    type: "direct",
    user_id: `user-${id}`,
    username: `name-${id}`,
    avatar_id: null,
    is_developer: false,
    ...more,
  }) as Chat;

async function open(pin: string) {
  lock.lockNow();
  await lock.enterPin(pin);
}

beforeEach(async () => {
  mock.timers.reset();
  duress.setLockSeemsOff(false);
  await duress.forgetDuress();
  await lock.turnOffLock();
  stored.clear();

  await lock.turnOnLock(PIN);
  await lock.setDuressPin(DURESS);
  await duress.saveDuressConfig({ safe: ["a", "b"], alert: null });
});

test("opened with the duress PIN only the safe chats show", async () => {
  await open(DURESS);
  assert.deepEqual(duress.useDuress(), new Set(["a", "b"]));

  await open(PIN);
  assert.equal(duress.useDuress(), null);
});

test("in duress without a config, no chat shows", async () => {
  await duress.saveDuressConfig(null);
  await open(DURESS);

  assert.deepEqual(duress.useDuress(), new Set());
});

test("the config is kept on the device", async () => {
  const config = { safe: ["c"], alert: { chatId: "c", text: "Call me" } };
  await duress.saveDuressConfig(config);
  await duress.loadDuress();

  assert.deepEqual(JSON.parse(stored.get("ostrich-duress")!), config);
  assert.deepEqual(duress.useDuressConfig(), config);
});

test("a chat started in duress stays shown then, once", async () => {
  await open(DURESS);
  await duress.showChatInDuress("c");
  await duress.showChatInDuress("c");
  await duress.showChatInDuress("a");

  assert.deepEqual(duress.useDuressConfig()!.safe, ["a", "b", "c"]);
  assert.deepEqual(duress.useDuress(), new Set(["a", "b", "c"]));
});

test("a chat started with the real PIN is not added", async () => {
  await open(PIN);
  await duress.showChatInDuress("c");

  assert.deepEqual(duress.useDuressConfig()!.safe, ["a", "b"]);
});

test("the made-up values come from the safe direct chats only", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 0, 1) });
  const safe = [
    chat("a"),
    chat("b"),
    chat("c"),
    chat("d"),
    chat("e"),
    chat("group", { type: "group", user_id: null, username: null }),
    chat("saved", { type: "saved" }),
    chat("gone", { username: null }),
  ];
  const friends = new Set(["a", "b", "c", "d", "e"].map((id) => `user-${id}`));

  // Made at random: what must hold every time.
  for (let i = 0; i < 100; i++) {
    await duress.makeFakeData(safe);
    const fake = duress.useFake()!;

    assert.deepEqual(fake.lock, { wipe: false, wipeAfterTries: false });
    assert.ok(fake.devices.length <= 2);
    assert.ok(fake.devices.every((device) => ["web", "android", "ios", "cli"].includes(device.client)));

    const changeAt = new Date(fake.usernameChangeAt!).getTime() - Date.now();
    assert.ok(changeAt >= 3 * DAY && changeAt < 27 * DAY);

    if (fake.disappear) {
      assert.ok([30, 90, 180, 365].includes(fake.disappear.days));
      assert.deepEqual(fake.disappear.messages, []);
    }

    if (fake.recovery) {
      const { guardians, threshold } = fake.recovery;
      assert.ok(guardians.length >= 2 && guardians.length <= 4);
      assert.ok(guardians.every((guardian) => friends.has(guardian.id)));
      assert.equal(new Set(guardians.map((guardian) => guardian.id)).size, guardians.length);
      assert.ok(threshold >= 2 && threshold <= guardians.length);
    }
  }

  assert.ok(stored.has("ostrich-duress-fake"));
});

test("with fewer than 2 friends there is no made-up recovery", async () => {
  for (let i = 0; i < 20; i++) {
    await duress.makeFakeData([chat("a"), chat("group", { type: "group", user_id: null })]);
    assert.equal(duress.useFake()!.recovery, null);
  }

  assert.deepEqual(duress.fakeRecovery(), { setup: null, requests: [] });
});

test("the made-up recovery lists the guardians by name", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 0, 1) });
  const guardians = ["zed", "amy", "kim"].map((name) => ({ id: name, username: name, avatar_id: null, is_developer: false }));
  await duress.makeFakeData([]);
  await duress.changeFake((fake) => ({ ...fake, recovery: { threshold: 2, guardians, daysAgo: 10 } }));

  const { setup } = duress.fakeRecovery();
  assert.deepEqual(
    setup!.guardians.map((guardian) => guardian.username),
    ["amy", "kim", "zed"],
  );
  assert.equal(setup!.threshold, 2);
  assert.equal(setup!.created_at, new Date(Date.now() - 10 * DAY).toISOString());
});

test("the made-up If I disappear starts again each time it is opened", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 0, 1) });
  await duress.makeFakeData([]);
  await duress.changeFake((fake) => ({ ...fake, disappear: null }));
  assert.deepEqual(duress.fakeDisappear(), { switch: null, messages: [] });

  await duress.changeFake((fake) => ({
    ...fake,
    disappear: { days: 30, messages: [{ id: "m", chatId: "a", content: "Bye", minutesAgo: 5 }] },
  }));
  mock.timers.tick(DAY);

  const status = duress.fakeDisappear();
  assert.equal(status.switch!.last_active_at, new Date(Date.now()).toISOString());
  assert.equal(status.switch!.due_at, new Date(Date.now() + 30 * DAY).toISOString());
  assert.equal(status.switch!.triggered_at, null);
  assert.deepEqual(status.messages, [
    {
      id: "m",
      chat_id: "a",
      content: "Bye",
      attachments: [],
      created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      stale: false,
    },
  ]);
});

test("the made-up username date is always ahead, moving on by 28 days", async () => {
  const now = Date.UTC(2026, 0, 1);
  mock.timers.enable({ apis: ["Date"], now });
  await duress.makeFakeData([]);
  await duress.changeFake((fake) => ({ ...fake, usernameChangeAt: new Date(now + 2 * DAY).toISOString() }));

  assert.equal(duress.fakeUsernameChangeAt(), new Date(now + 2 * DAY).toISOString());

  mock.timers.tick(2 * DAY);
  assert.equal(duress.fakeUsernameChangeAt(), new Date(now + 30 * DAY).toISOString());

  mock.timers.tick(60 * DAY);
  assert.equal(duress.fakeUsernameChangeAt(), new Date(now + 86 * DAY).toISOString());
});

test("the made-up devices keep this one and hide the others", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 0, 1) });
  await duress.makeFakeData([]);
  await duress.changeFake((fake) => ({ ...fake, devices: [{ id: "fake", client: "ios", daysAgo: 3, minutesAgo: 30 }] }));
  const session = (id: string, current: boolean): Session => ({
    id,
    client: "web",
    created_at: "2025-01-01T00:00:00.000Z",
    last_used_at: "2025-01-01T00:00:00.000Z",
    current,
  });

  assert.deepEqual(duress.fakeSessions([session("other", false), session("this", true)]), [
    session("this", true),
    {
      id: "fake",
      client: "ios",
      created_at: new Date(Date.now() - 3 * DAY).toISOString(),
      last_used_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      current: false,
    },
  ]);
});

test("without made-up values there is nothing to change", async () => {
  let called = false;
  await duress.changeFake((fake) => {
    called = true;
    return fake;
  });

  assert.equal(called, false);
  assert.equal(duress.useFake(), null);
});

test("turning off the lock in duress only looks so", async () => {
  await open(DURESS);
  duress.setLockSeemsOff(true);
  assert.equal(duress.lockSeemsOff(), true);
  assert.equal(duress.useLockSeemsOff(), true);
  assert.ok(lock.useLock().config);

  // Locked and opened with the real PIN, it is on as it was.
  await open(PIN);
  assert.equal(duress.lockSeemsOff(), false);
});

test("forgetting it removes the config and the made-up values", async () => {
  await duress.makeFakeData([chat("a")]);
  await duress.forgetDuress();
  await duress.loadDuress();

  assert.equal(stored.has("ostrich-duress"), false);
  assert.equal(stored.has("ostrich-duress-fake"), false);
  assert.equal(duress.useDuressConfig(), null);
  assert.equal(duress.useFake(), null);
});
