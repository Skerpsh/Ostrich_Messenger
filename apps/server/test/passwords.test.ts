import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, limited, MAX_RUNNING, MAX_WAITING, verifyPassword } from "../src/passwords.js";

test("passwords are checked by few at a time, and the rest are refused", async () => {
  let started = 0;
  const release: (() => void)[] = [];

  const work = () => {
    started++;
    return new Promise<void>((resolve) => release.push(resolve));
  };

  const accepted = Array.from({ length: MAX_RUNNING + MAX_WAITING }, () => limited(work));

  await assert.rejects(limited(work), { statusCode: 429 });
  assert.equal(started, MAX_RUNNING);

  // Each one that ends lets a waiting one start, until all have run.
  while (release.length > 0) {
    release.shift()!();
    await new Promise((resolve) => setImmediate(resolve));
  }

  await Promise.all(accepted);
  assert.equal(started, MAX_RUNNING + MAX_WAITING);
});

test("a failed check gives its place back", async () => {
  for (let i = 0; i < MAX_RUNNING + 1; i++) {
    await assert.rejects(limited(() => Promise.reject(new Error("failed"))), /failed/);
  }

  assert.equal(await limited(async () => "free"), "free");
});

test("a password checks against its hash", async () => {
  const hash = await hashPassword("correct horse");

  assert.equal(await verifyPassword(hash, "correct horse"), true);
  assert.equal(await verifyPassword(hash, "wrong horse"), false);
});
