/// <reference types="node" />
// npm test. The same vectors are checked by apps/cli/recovery_test.go, so
// the app and the CLI can be each other's guardians.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  combineShares,
  createAccountKeys,
  deriveFromOstrichId,
  fromBase64,
  openForRecovery,
  ostrichIdBytes,
  ostrichIdFromBytes,
  recoverOstrichId,
  recoveryCode,
  requestContext,
  sealForRecovery,
  shareContext,
  splitSecret,
  toHex,
} from "./crypto.ts";

const all = JSON.parse(
  readFileSync(new URL("../../../../shared/test-vectors/crypto-vectors.json", import.meta.url), "utf8"),
);
const v = all.recovery;
const hex = (text: string) => Uint8Array.from(text.match(/../g)!.map((b) => parseInt(b, 16)));

test("an OstrichID split 3 of 5: any 3 shares give it back", () => {
  const secret = hex(v.secret_hex);
  const coefficients = hex(v.coefficients_hex);
  const shares = splitSecret(secret, 5, 3, () => coefficients);

  assert.deepEqual(shares.map(toHex), v.shares_hex);

  for (const pick of [[0, 1, 2], [0, 2, 4], [4, 3, 1], [0, 1, 2, 3, 4]]) {
    assert.deepEqual(combineShares(pick.map((i) => shares[i])), secret);
  }

  // Two say nothing of it.
  assert.notDeepEqual(combineShares([shares[0], shares[1]]), secret);
  assert.equal(ostrichIdFromBytes(secret), all.ostrich_id.replace(/-/g, ""));
});

test("random splits of other sizes", () => {
  const secret = ostrichIdBytes("K7QM3XRA9TPWH2DCM8VN");

  for (const [total, threshold] of [[2, 2], [3, 2], [10, 7]]) {
    const shares = splitSecret(secret, total, threshold);
    assert.deepEqual(combineShares(shares.slice(total - threshold)), secret);
  }

  assert.throws(() => splitSecret(secret, 3, 1));
  assert.throws(() => splitSecret(secret, 2, 3));
});

test("a share sealed for its guardian, and again for the new device", () => {
  const share = openForRecovery(
    fromBase64(all.private_key_b),
    v.sealer_public_key,
    v.sealed_share,
    shareContext(v.setup_id, all.member_id_b),
  );
  assert.equal(toHex(share), v.shares_hex[1]);

  // Not for another guardian or setup.
  assert.throws(() =>
    openForRecovery(fromBase64(all.private_key_b), v.sealer_public_key, v.sealed_share, shareContext(v.setup_id, all.sender_id)),
  );

  const requestId = "55555555-5555-4555-8555-555555555555";
  const devicePublic = all.public_key_a;
  const again = sealForRecovery(devicePublic, share, requestContext(requestId));
  assert.equal(
    toHex(openForRecovery(fromBase64(all.private_key_a), again.publicKey, again.sealed, requestContext(requestId))),
    v.shares_hex[1],
  );
});

test("the recovery code", () => {
  assert.equal(recoveryCode(all.public_key_a), v.recovery_code);
  assert.match(v.recovery_code, /^\d{3} \d{3}$/);
});

test("the OstrichID from the guardians' shares, past a wrong one", () => {
  const id = "K7QM3XRA9TPWH2DCM8VN";
  const { material } = createAccountKeys(deriveFromOstrichId(id));
  const shares = splitSecret(ostrichIdBytes(id), 5, 3);
  const wrong = Uint8Array.from(shares[1], (byte, i) => (i === 0 ? byte : byte ^ 0x55));

  assert.equal(recoverOstrichId([shares[0], wrong, shares[2], shares[3]], 3, material.encrypted_private_key), id);
  assert.equal(recoverOstrichId([shares[0], wrong, shares[2]], 3, material.encrypted_private_key), null);
  assert.equal(recoverOstrichId(shares.slice(0, 2), 3, material.encrypted_private_key), null);
});
