import assert from "node:assert/strict";
import { test } from "node:test";
import { dueAt, warningDue } from "../src/disappear.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test("warnings: a week, a day and an hour before", () => {
  assert.equal(warningDue(10 * DAY, 30), 0);
  assert.equal(warningDue(7 * DAY, 30), 1);
  assert.equal(warningDue(2 * DAY, 30), 1);
  assert.equal(warningDue(DAY, 30), 2);
  assert.equal(warningDue(HOUR, 30), 3);
  assert.equal(warningDue(1, 30), 3);
});

test("warnings longer than the period are left out", () => {
  // Two days: no "in 7 days" right after turning it on.
  assert.equal(warningDue(2 * DAY - 1, 2), 0);
  assert.equal(warningDue(DAY, 2), 2);
  // A week exactly: the week's warning would come at once.
  assert.equal(warningDue(7 * DAY, 7), 0);
  assert.equal(warningDue(7 * DAY, 8), 1);
});

test("it goes off the days after the user was last active", () => {
  assert.equal(dueAt(new Date("2026-10-21T12:00:00Z"), 30).toISOString(), "2026-11-20T12:00:00.000Z");
});
