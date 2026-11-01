import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listedFor, RELEASE_PUBLIC_KEY, signatureValid, verifyUpdate } from "./verify-update.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
// The raw key: the last 32 bytes of its DER form.
const rawKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

const installer = Buffer.from("the installer");
const hash = createHash("sha256").update(installer).digest("hex");
const file = path.join(mkdtempSync(path.join(tmpdir(), "ostrich-update-")), "update.deb");
writeFileSync(file, installer);

// A release with these files, as fetch would give them.
function release(files) {
  return async (url) => {
    const body = files[url.split("/").pop()];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, arrayBuffer: async () => body };
  };
}

function signedRelease(sumsText, key = privateKey) {
  const sums = Buffer.from(sumsText);
  return release({ SHA256SUMS: sums, "SHA256SUMS.sig": sign(null, sums, key) });
}

const options = (fetchFile) => ({ fetchFile, publicKey: rawKey });

test("accepts a file listed in the signed SHA256SUMS of its version", async () => {
  await verifyUpdate(file, "1.6.0", options(signedRelease(`${hash}  Ostrich-Linux-1.6.0.deb\n`)));
});

test("refuses SHA256SUMS changed after signing", async () => {
  const sums = Buffer.from(`${hash}  Ostrich-Linux-1.6.0.deb\n`);
  const fetchFile = release({
    SHA256SUMS: Buffer.from(`${"0".repeat(64)}  Ostrich-Linux-1.6.0.deb\n`),
    "SHA256SUMS.sig": sign(null, sums, privateKey),
  });

  await assert.rejects(verifyUpdate(file, "1.6.0", options(fetchFile)), /not signed/);
});

test("refuses a signature by another key", async () => {
  const other = generateKeyPairSync("ed25519").privateKey;
  const fetchFile = signedRelease(`${hash}  Ostrich-Linux-1.6.0.deb\n`, other);

  await assert.rejects(verifyUpdate(file, "1.6.0", options(fetchFile)), /not signed/);
});

test("refuses a file that is not in the list", async () => {
  const fetchFile = signedRelease(`${"0".repeat(64)}  Ostrich-Linux-1.6.0.deb\n`);

  await assert.rejects(verifyUpdate(file, "1.6.0", options(fetchFile)), /not in the signed/);
});

test("refuses an older signed release passed off as a new version", async () => {
  const fetchFile = signedRelease(`${hash}  Ostrich-Linux-1.5.0.deb\n`);

  await assert.rejects(verifyUpdate(file, "1.6.0", options(fetchFile)), /not in the signed/);
});

test("refuses a release without a signature", async () => {
  const fetchFile = release({ SHA256SUMS: Buffer.from(`${hash}  Ostrich-Linux-1.6.0.deb\n`) });

  await assert.rejects(verifyUpdate(file, "1.6.0", options(fetchFile)), /could not load SHA256SUMS\.sig/);
});

test("listedFor takes only installers of the exact version", () => {
  const sums = Buffer.from(`${hash}  Ostrich-Windows-Setup-1.6.0.exe\n${hash} *Ostrich-Linux-1.6.1.AppImage\n`);

  assert.equal(listedFor(sums, hash, "1.6.0"), true);
  assert.equal(listedFor(sums, hash, "1.6.1"), true);
  assert.equal(listedFor(sums, hash, "1.6"), false);
  assert.equal(listedFor(Buffer.from(`${hash}  ostrich-linux-amd64-1.6.0\n`), hash, "1.6.0"), false);
});

test("a broken key or signature is a refusal, not an error", () => {
  assert.equal(signatureValid(Buffer.from("x"), Buffer.from("y"), "bad"), false);
  assert.equal(signatureValid(Buffer.from("x"), Buffer.from("y")), false);
});

test("the key is the one the CLI checks releases with", () => {
  const cli = readFileSync(new URL("../cli/version.go", import.meta.url), "utf8");

  assert.equal(/releasePublicKey = "([^"]+)"/.exec(cli)?.[1], RELEASE_PUBLIC_KEY);
});
