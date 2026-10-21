/// <reference types="node" />
// npm test. The same vectors are checked by apps/cli/sealed_test.go, so the
// app and the CLI open each other's sealed letters.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { openingTime, openLetter, roundAt, sealLetter } from "./sealed.ts";

const v = JSON.parse(
  readFileSync(new URL("../../../../../shared/test-vectors/crypto-vectors.json", import.meta.url), "utf8"),
).sealed_letter;

const signature = async (round: number) => {
  assert.equal(round, v.round);
  return v.signature as string;
};

test("rounds and their times", () => {
  assert.equal(openingTime(1), 1692803367000);
  assert.equal(roundAt(openingTime(v.round)), v.round);
  // Between two rounds: the next one, not before the time.
  assert.equal(roundAt(openingTime(v.round) + 1), v.round + 1);
});

// First: signatures that opened a letter are kept for the session.
test("a made-up signature does not open a letter", async () => {
  const other = "a".repeat(96);
  await assert.rejects(openLetter({ round: v.round, box: v.box_go }, async () => other));
  // Nor does the signature of another round.
  const sealed = await sealLetter("Not yet", openingTime(v.round + 1), false);
  await assert.rejects(openLetter(sealed, async () => v.signature));
});

test("letters sealed by the CLI and by the app open", async () => {
  assert.equal(await openLetter({ round: v.round, box: v.box_go }, signature), v.inner);
  assert.equal(await openLetter({ round: v.round, box: v.box_js }, signature), v.inner);

  const sealed = await sealLetter("A letter to the future", openingTime(v.round), true);
  assert.equal(sealed.round, v.round);
  assert.equal(sealed.surprise, true);
  assert.equal(await openLetter(sealed, signature), "A letter to the future");
});



test("a sealed letter in a message's payload", async () => {
  const { decodePayload, encodePayload } = await import("./payload.ts");
  const letter = { round: v.round, box: v.box_js as string, surprise: true };
  const wire = encodePayload({ text: "🔒 A sealed letter", sealed: { ...letter, opened: true } });

  // Opened is this device's: never sent.
  assert.deepEqual(decodePayload(wire), { text: "🔒 A sealed letter", sealed: letter });
  assert.equal(decodePayload(wire.replace('"r":1000000', '"r":0')).sealed, undefined);
});
