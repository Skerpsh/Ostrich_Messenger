/// <reference types="node" />
// npm test. The app lock with a PIN, a wipe PIN and the duress PIN, on an
// in-memory storage (src/test/).
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import "../../test/modules.ts";
import { stored } from "../../test/storage.ts";

const lock = await import("./lock.ts");
const { enterPin, isPin, loadLock } = lock;
// The store's state now (a plain call here: see src/test/react.ts).
const { useLock: lockState } = lock;

const PIN = "1234";
const WIPE = "0000";
const DURESS = "5555";
const WRONG = "9999";

// What the app keeps, and what it finds when it starts again.
const restart = () => loadLock();

beforeEach(async () => {
  mock.timers.reset();
  await lock.turnOffLock();
  lock.forgetLock();
  stored.clear();
  await restart();
});

async function turnOn({ wipe = false, duress = false, wipeAfterTries = false } = {}) {
  await lock.turnOnLock(PIN);

  if (wipe) {
    await lock.setWipePin(WIPE);
  }

  if (duress) {
    await lock.setDuressPin(DURESS);
  }

  await lock.setWipeAfterTries(wipeAfterTries);
  await restart();
}

async function wrong(times: number) {
  let result;

  for (let i = 0; i < times; i++) {
    result = await enterPin(WRONG);
  }

  return result!;
}

test("PINs are 4 digits", () => {
  assert.ok(lock.validPin("0123"));

  for (const pin of ["123", "12345", "12a4", " 123", ""]) {
    assert.ok(!lock.validPin(pin), pin);
  }
});

test("without a PIN the app is not locked", async () => {
  assert.equal(lockState().locked, false);
  assert.deepEqual(await enterPin(WRONG), { kind: "unlock" });

  lock.lockNow();
  assert.equal(lockState().locked, false);
});

test("the PIN is kept as a hash, and asked again at start", async () => {
  await turnOn();

  const saved = stored.get("ostrich-app-lock")!;
  assert.ok(!saved.includes(PIN));
  assert.match(JSON.parse(saved).pin, /^[0-9a-f]{64}$/);
  assert.equal(lockState().locked, true);

  assert.deepEqual(await enterPin(PIN), { kind: "unlock" });
  assert.equal(lockState().locked, false);
  assert.equal(lockState().duress, false);

  lock.lockNow();
  assert.equal(lockState().locked, true);
});

test("the same PIN hashes differently on another turn on", async () => {
  await turnOn();
  const first = JSON.parse(stored.get("ostrich-app-lock")!);
  await turnOn();
  const second = JSON.parse(stored.get("ostrich-app-lock")!);

  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.pin, second.pin);
});

test("from the 5th wrong PIN in a row it waits, longer each time", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  await turnOn();

  for (let count = 1; count <= 4; count++) {
    assert.deepEqual(await enterPin(WRONG), { kind: "wrong", failures: count, waitUntil: Date.now() });
  }

  const waits = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 60 * 60_000];

  for (const [i, wait] of waits.entries()) {
    const result = await enterPin(WRONG);
    assert.deepEqual(result, { kind: "wrong", failures: 5 + i, waitUntil: Date.now() + wait });

    // While waiting even the right PIN does not open it, and a wrong one
    // does not count.
    assert.deepEqual(await enterPin(PIN), { kind: "wait", waitUntil: Date.now() + wait });
    assert.deepEqual(await enterPin(WRONG), { kind: "wait", waitUntil: Date.now() + wait });
    assert.equal(lockState().locked, true);

    mock.timers.tick(wait);
  }

  assert.deepEqual(await enterPin(PIN), { kind: "unlock" });
  assert.deepEqual(lockState().failures, { count: 0, until: 0 });
});

test("restarting the app does not reset the waiting", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  await turnOn();
  const result = await wrong(5);

  await restart();

  assert.deepEqual(lockState().failures, { count: 5, until: Date.now() + 30_000 });
  assert.deepEqual(await enterPin(PIN), { kind: "wait", waitUntil: Date.now() + 30_000 });
  assert.equal(result.kind, "wrong");
});

test("the right PIN starts the count of wrong PINs again", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  await turnOn();
  await wrong(4);
  await enterPin(PIN);

  assert.deepEqual(await enterPin(WRONG), { kind: "wrong", failures: 1, waitUntil: Date.now() });
});

test("the wipe PIN wipes, even while waiting", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  await turnOn({ wipe: true });

  assert.deepEqual(await enterPin(WIPE), { kind: "wipe" });
  assert.equal(lockState().locked, true);

  await wrong(5);
  assert.deepEqual(await enterPin(WIPE), { kind: "wipe" });
});

test("without a wipe PIN set, no PIN wipes", async () => {
  await turnOn();

  assert.equal((await enterPin(WIPE)).kind, "wrong");
});

test("10 wrong PINs in a row wipe, when chosen", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  await turnOn({ wipeAfterTries: true });

  for (let count = 1; count < lock.WIPE_AFTER; count++) {
    assert.equal((await enterPin(WRONG)).kind, "wrong");
    mock.timers.tick(60 * 60_000);
  }

  assert.deepEqual(await enterPin(WRONG), { kind: "wipe" });
});

test("10 wrong PINs do not wipe when not chosen", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  await turnOn();

  for (let count = 1; count <= lock.WIPE_AFTER + 2; count++) {
    assert.equal((await enterPin(WRONG)).kind, "wrong");
    mock.timers.tick(60 * 60_000);
  }
});

test("the duress PIN opens it in duress, the real PIN opens it as it is", async () => {
  await turnOn({ duress: true });

  assert.deepEqual(await enterPin(DURESS), { kind: "duress" });
  assert.equal(lockState().locked, false);
  assert.equal(lockState().duress, true);
  assert.equal(lock.inDuress(), true);

  // It stays so until locked and opened with the real PIN.
  lock.lockNow();
  assert.equal(lockState().duress, true);
  assert.deepEqual(await enterPin(PIN), { kind: "unlock" });
  assert.equal(lock.inDuress(), false);
});

test("each opening counts, with either PIN", async () => {
  await turnOn({ duress: true });
  const before = lockState().opened;

  await enterPin(DURESS);
  lock.lockNow();
  await enterPin(PIN);
  lock.lockNow();
  await enterPin(WRONG);

  assert.equal(lockState().opened, before + 2);
});

test("the duress PIN starts the count of wrong PINs again", async () => {
  await turnOn({ duress: true });
  await wrong(4);
  await enterPin(DURESS);

  assert.deepEqual(lockState().failures, { count: 0, until: 0 });
});

test("in duress, the duress PIN is the PIN the settings know", async () => {
  await turnOn({ duress: true });

  await enterPin(PIN);
  assert.equal(await isPin(PIN), true);
  assert.equal(await isPin(DURESS), false);

  lock.lockNow();
  await enterPin(DURESS);
  assert.equal(await isPin(DURESS), true);
  assert.equal(await isPin(PIN), false);
});

test("changing the PIN in duress changes the duress PIN, the real one stays", async () => {
  await turnOn({ duress: true });
  await enterPin(DURESS);

  await lock.changePin("7777");
  lock.lockNow();

  assert.equal((await enterPin(DURESS)).kind, "wrong");
  assert.equal((await enterPin("7777")).kind, "duress");
  lock.lockNow();
  assert.equal((await enterPin(PIN)).kind, "unlock");
});

test("changing the PIN otherwise changes the real one", async () => {
  await turnOn({ duress: true });
  await enterPin(PIN);

  await lock.changePin("7777");
  lock.lockNow();

  assert.equal((await enterPin(PIN)).kind, "wrong");
  assert.equal((await enterPin("7777")).kind, "unlock");
  lock.lockNow();
  assert.equal((await enterPin(DURESS)).kind, "duress");
});

test("the PIN, the wipe PIN and the duress PIN must all differ", async () => {
  await turnOn({ wipe: true, duress: true });
  const before = stored.get("ostrich-app-lock");
  const another = { message: "Choose another PIN" };

  await assert.rejects(lock.setWipePin(PIN), another);
  await assert.rejects(lock.setWipePin(DURESS), another);
  await assert.rejects(lock.setDuressPin(PIN), another);
  await assert.rejects(lock.setDuressPin(WIPE), another);
  await assert.rejects(lock.changePin(WIPE), another);
  await assert.rejects(lock.changePin(DURESS), another);

  await enterPin(DURESS);
  await assert.rejects(lock.changePin(PIN), another);
  await assert.rejects(lock.changePin(WIPE), another);

  assert.equal(stored.get("ostrich-app-lock"), before);
});

test("turning off the wipe PIN and the duress PIN", async () => {
  await turnOn({ wipe: true, duress: true });

  await lock.setWipePin(null);
  await lock.setDuressPin(null);
  await restart();

  assert.equal((await enterPin(WIPE)).kind, "wrong");
  assert.equal((await enterPin(DURESS)).kind, "wrong");
  assert.equal(lockState().duress, false);
});

test("turning off the lock forgets the PINs and the waiting", async () => {
  await turnOn({ duress: true });
  await wrong(5);

  await lock.turnOffLock();

  assert.equal(stored.has("ostrich-app-lock"), false);
  assert.equal(stored.has("ostrich-app-lock-failures"), false);
  assert.deepEqual(lockState().failures, { count: 0, until: 0 });

  await restart();
  assert.equal(lockState().locked, false);
  assert.equal(lockState().config, null);
});

test("a damaged config is no lock", async () => {
  stored.set("ostrich-app-lock", "{not json");
  stored.set("ostrich-app-lock-failures", "[");
  await restart();

  assert.equal(lockState().locked, false);
  assert.deepEqual(lockState().failures, { count: 0, until: 0 });
});

test("the background lock and wipe after tries are kept", async () => {
  await turnOn();
  assert.equal(lockState().config!.background, 1);

  await lock.setBackgroundLock(null);
  await lock.setWipeAfterTries(true);
  await restart();

  assert.equal(lockState().config!.background, null);
  assert.equal(lockState().config!.wipeAfterTries, true);
});
