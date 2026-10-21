import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deliveryTime,
  groupEpochOf,
  isReactionEmoji,
  isEncryptedMessage,
  MAX_MESSAGE_LENGTH,
  needsClientId,
  withReply,
} from "../src/messages.js";
import { currentRound, QUICKNET } from "../src/routes/drand.js";

test("only encrypted messages are accepted", () => {
  assert.ok(isEncryptedMessage("e2:AAAA"));
  // "e1" (bound to the chat only) is no longer accepted.
  assert.ok(!isEncryptedMessage("e1:AAAA=="));
  assert.ok(!isEncryptedMessage("hello"));
  assert.ok(!isEncryptedMessage("e3:AAAA"));
  assert.ok(!isEncryptedMessage("e2:AA AA"));
  assert.ok(!isEncryptedMessage("e2:" + "A".repeat(MAX_MESSAGE_LENGTH)));
});

test("e2 messages need the id chosen by the client", () => {
  assert.ok(needsClientId("e2:AAAA"));
  assert.ok(!needsClientId("e1:AAAA"));
});

test("reply columns become reply_to", () => {
  const empty = {
    reply_id: null,
    reply_sender_id: null,
    reply_sender_username: null,
    reply_sender_is_developer: null,
    reply_content: null,
  };

  assert.deepEqual(withReply({ id: "m", ...empty }), { id: "m", reply_to: null });

  assert.deepEqual(
    withReply({
      id: "m",
      reply_id: "r",
      reply_sender_id: "u",
      reply_sender_username: "alice",
      reply_sender_is_developer: null,
      reply_content: "e2:AAAA",
    }),
    {
      id: "m",
      reply_to: {
        id: "r",
        sender_id: "u",
        sender_username: "alice",
        sender_is_developer: false,
        content: "e2:AAAA",
      },
    },
  );
});

test("group messages carry their key epoch", () => {
  assert.ok(isEncryptedMessage("e3:12:AAAA"));
  assert.ok(!isEncryptedMessage("e3:AAAA"));
  assert.ok(!isEncryptedMessage("e3:x:AAAA"));
  assert.ok(needsClientId("e3:1:AAAA"));
  assert.equal(groupEpochOf("e3:12:AAAA"), 12);
  assert.equal(groupEpochOf("e2:AAAA"), null);
});

test("a reaction is one emoji", () => {
  for (const emoji of ["👍", "❤️", "🦤", "👍🏽", "👨‍👩‍👧", "🇺🇦", "#️⃣"]) {
    assert.ok(isReactionEmoji(emoji), emoji);
  }

  for (const text of ["", "a", "👍👍", "ok", "👍 ", "<script>"]) {
    assert.ok(!isReactionEmoji(text), text);
  }
});

test("surprises are delivered from a minute to ten years ahead", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");

  assert.equal(deliveryTime("2026-10-21T12:00:30Z", now), null);
  assert.equal(deliveryTime("2026-10-21T12:01:00Z", now)?.toISOString(), "2026-10-21T12:01:00.000Z");
  assert.equal(deliveryTime("2036-10-21T12:00:00Z", now)?.toISOString(), "2036-10-21T12:00:00.000Z");
  assert.equal(deliveryTime("2036-10-24T12:00:00Z", now), null);
  assert.equal(deliveryTime("tomorrow", now), null);
});

test("drand rounds: one every 3 seconds from quicknet's genesis", () => {
  const genesis = QUICKNET.genesisTime * 1000;

  assert.equal(currentRound(genesis), 1);
  assert.equal(currentRound(genesis + 2_999), 1);
  assert.equal(currentRound(genesis + 3_000), 2);
});
