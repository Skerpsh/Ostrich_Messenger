// Checks a downloaded update against the release's SHA256SUMS, signed by
// release.yml. electron-updater only compares the file with latest*.yml,
// which comes from the same release: whoever could change the one could
// change the other. The signature is what they cannot make (security audit
// SEC-011). Apart from main.js so that it can be tested without Electron.
import { createHash, createPublicKey, verify } from "node:crypto";
import { createReadStream } from "node:fs";

// The same key as releasePublicKey in apps/cli/version.go (a test checks).
export const RELEASE_PUBLIC_KEY = "Zn7AoRPQh0TtFNiJOCnLELZeCeqp74kjK7pdEST9+Wk=";

const RELEASES = "https://github.com/Skerpsh/Ostrich_Messenger/releases/download";
// What a raw Ed25519 public key needs in front to be read as DER (SPKI).
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const INSTALLER = /^Ostrich-(?:Linux|Windows-Setup)-(.+)\.(?:AppImage|deb|rpm|pacman|exe)$/;

export function signatureValid(sums, signature, publicKey = RELEASE_PUBLIC_KEY) {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, "base64")]),
      format: "der",
      type: "spki",
    });

    return verify(null, sums, key, signature);
  } catch {
    return false;
  }
}

// Whether the signed list has this hash as an installer of this very
// version: an older signed release passed off as a new one does not count.
export function listedFor(sums, hash, version) {
  return sums
    .toString("utf8")
    .split("\n")
    .some((line) => {
      const [sum, name] = line.trim().split(/\s+/);

      return sum === hash && INSTALLER.exec(name?.replace(/^\*/, "") ?? "")?.[1] === version;
    });
}

async function sha256Of(file) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

async function download(url, fetchFile) {
  const response = await fetchFile(url, { signal: AbortSignal.timeout(30_000) });

  if (!response.ok) {
    throw new Error(`could not load ${url.split("/").pop()} (${response.status})`);
  }

  return Buffer.from(await response.arrayBuffer());
}

// Throws unless `file` is what the signed list of `version` says. The
// version comes from latest*.yml, so it is escaped in the address.
export async function verifyUpdate(file, version, { fetchFile = fetch, publicKey = RELEASE_PUBLIC_KEY } = {}) {
  const base = `${RELEASES}/v${encodeURIComponent(version)}`;
  const [sums, signature] = await Promise.all([
    download(`${base}/SHA256SUMS`, fetchFile),
    download(`${base}/SHA256SUMS.sig`, fetchFile),
  ]);

  if (!signatureValid(sums, signature, publicKey)) {
    throw new Error("SHA256SUMS is not signed by Ostrich's release key");
  }

  if (!listedFor(sums, await sha256Of(file), version)) {
    throw new Error("the download is not in the signed SHA256SUMS");
  }
}
