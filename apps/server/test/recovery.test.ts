import assert from "node:assert/strict";
import test from "node:test";
import { requestState } from "../src/recovery.js";

const now = new Date("2026-10-22T12:00:00Z");
const hours = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000);

const request = (changes: Partial<Parameters<typeof requestState>[0]> = {}) => ({
  ready_at: hours(-1),
  expires_at: hours(100),
  cancelled_at: null,
  completed_at: null,
  ...changes,
});

test("ready after the delay with enough approvals", () => {
  assert.equal(requestState(request(), 3, 3, now), "ready");
  assert.equal(requestState(request(), 4, 3, now), "ready");
});

test("waits for the delay, and for the approvals", () => {
  assert.equal(requestState(request({ ready_at: hours(1) }), 5, 3, now), "waiting");
  assert.equal(requestState(request(), 2, 3, now), "waiting");
});

test("over when cancelled, used or expired", () => {
  assert.equal(requestState(request({ cancelled_at: hours(-2) }), 3, 3, now), "cancelled");
  assert.equal(requestState(request({ completed_at: hours(-2) }), 3, 3, now), "completed");
  assert.equal(requestState(request({ expires_at: now }), 3, 3, now), "expired");
});
