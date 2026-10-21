/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commitment,
  fingerprintOf,
  handshakePhrases,
  phraseChoices,
  phraseEmoji,
  phraseText,
  samePhrase,
  type Phrase,
} from "./handshake.ts";

const input = {
  callId: "6f1c2c1e-3f47-4c8e-9a51-0b8f4f7f2a10",
  callerFingerprint: "AA:BB:CC",
  calleeFingerprint: "DD:EE:FF",
  callerNonce: "00112233445566778899aabbccddeeff",
  calleeNonce: "ffeeddccbbaa99887766554433221100",
};

test("both sides make the same two sentences", () => {
  const a = handshakePhrases(input);
  const b = handshakePhrases({ ...input, callerFingerprint: "aa:bb:cc", calleeNonce: input.calleeNonce.toUpperCase() });

  assert.ok(samePhrase(a.caller, b.caller));
  assert.ok(samePhrase(a.callee, b.callee));
});

test("another certificate or nonce makes other sentences", () => {
  const a = handshakePhrases(input);

  for (const change of [
    { callerFingerprint: "AA:BB:CD" },
    { calleeFingerprint: "DD:EE:FE" },
    { callerNonce: "1" + input.callerNonce.slice(1) },
    { calleeNonce: "0" + input.calleeNonce.slice(1) },
    { callId: "7f1c2c1e-3f47-4c8e-9a51-0b8f4f7f2a10" },
  ]) {
    const b = handshakePhrases({ ...input, ...change });
    assert.ok(!samePhrase(a.caller, b.caller) || !samePhrase(a.callee, b.callee), JSON.stringify(change));
  }
});

test("every word of the lists can be said", () => {
  for (let i = 0; i < 32; i++) {
    const phrase: Phrase = [i, i, i, i];
    assert.match(phraseText(phrase), /^[A-Z][a-z]+ [a-z]+ [a-z]+ [a-z]+$/);
    assert.equal(phraseEmoji(phrase).split(" ").length, 2);
  }

  assert.equal(phraseText([0, 0, 0, 0]), "Sleepy flamingo juggles cacti");
});

test("four choices: the right one and three sharing no word with it", () => {
  const right: Phrase = [1, 2, 3, 4];

  for (let round = 0; round < 50; round++) {
    const choices = phraseChoices(right);

    assert.equal(choices.length, 4);
    assert.equal(choices.filter((c) => samePhrase(c, right)).length, 1);

    for (const a of choices) {
      for (const b of choices) {
        if (a !== b) {
          assert.ok(a.every((word, i) => word !== b[i]));
        }
      }
    }
  }
});

test("the right sentence is not always in the same place", () => {
  const right: Phrase = [5, 6, 7, 8];
  const places = new Set<number>();

  for (let round = 0; round < 200; round++) {
    places.add(phraseChoices(right).findIndex((c) => samePhrase(c, right)));
  }

  assert.deepEqual([...places].sort(), [0, 1, 2, 3]);
});

test("commitments and fingerprints", () => {
  assert.equal(commitment("AB"), commitment("ab"));
  assert.notEqual(commitment("ab"), commitment("ac"));
  assert.match(commitment("ab"), /^[0-9a-f]{64}$/);

  const sdp = "v=0\r\na=group:BUNDLE 0\r\na=fingerprint:sha-256 0a:1B:2C\r\na=setup:actpass\r\n";
  assert.equal(fingerprintOf(sdp), "0A:1B:2C");
  assert.equal(fingerprintOf("v=0\r\n"), null);
});
