import { Buffer, timelockDecrypt, timelockEncrypt, type ChainClient, type ChainInfo } from "tlock-js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// Sealed letters: a message's real payload time-locked to a round of
// drand's quicknet (https://drand.love) with tlock, inside the usual
// end-to-end encryption. Nobody can open it before the round, the sender
// neither: the round's signature, published by drand then, is its key.
// Signatures come through the server (/api/drand), which cannot make one
// up: they are checked against quicknet's public key below. The CLI does
// the same (apps/cli/sealed.go).

export const QUICKNET: ChainInfo = {
  public_key:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  period: 3,
  genesis_time: 1692803367,
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  groupHash: "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
  schemeID: "bls-unchained-g1-rfc9380",
  metadata: { beaconID: "quicknet" },
};

// The longest a letter can be sealed for, and the shortest (as the server
// delivers surprises).
export const MAX_SEAL_YEARS = 10;
export const MIN_SEAL_MS = 60 * 1000;

// The text clients that do not know sealed letters show.
export const SEALED_FALLBACK = "🔒 A sealed letter";

export type SealedLetter = {
  round: number;
  // tlock's armored age file of the encoded payload (payload.ts).
  box: string;
  // Sent as a surprise: the server kept it from the others until then.
  surprise?: boolean;
  // On this device only (never sent): its payload is shown instead.
  opened?: boolean;
};

// The first round published at or after `time` (ms).
export function roundAt(time: number) {
  return Math.max(Math.ceil((time / 1000 - QUICKNET.genesis_time) / QUICKNET.period), 0) + 1;
}

// When the round is published (ms).
export function openingTime(round: number) {
  return (QUICKNET.genesis_time + (round - 1) * QUICKNET.period) * 1000;
}

// A round's signature, as the server passes it on.
export type GetSignature = (round: number) => Promise<string>;

function client(getSignature: GetSignature | null): ChainClient {
  return {
    options: {
      disableBeaconVerification: false,
      noCache: false,
      chainVerificationParams: { chainHash: QUICKNET.hash, publicKey: QUICKNET.public_key },
    },
    chain: () => ({
      baseUrl: "",
      // tlock-js checks this device's clock against the round's time;
      // the server's says whether a round has come (it refuses the ones
      // that have not), so the check is moved out of the way. Verifying a
      // signature does not use the genesis time.
      info: async () => (getSignature ? { ...QUICKNET, genesis_time: 0 } : QUICKNET),
    }),
    latest: () => Promise.reject(new Error("Only rounds of sealed letters are fetched")),
    get: async (round) => {
      if (!getSignature) {
        throw new Error("Sealing needs no signature");
      }

      const signature = await getSignature(round);

      // The randomness is the signature's hash; the signature is checked.
      return { round, signature, randomness: bytesToHex(sha256(Buffer.from(signature, "hex"))) };
    },
  };
}

// Time-locks an encoded payload until `opensAt` (ms); needs no network.
export async function sealLetter(inner: string, opensAt: number, surprise: boolean): Promise<SealedLetter> {
  const round = roundAt(opensAt);
  const box = await timelockEncrypt(round, Buffer.from(inner, "utf8"), client(null));

  return { round, box, ...(surprise ? { surprise: true } : {}) };
}

// Signatures that opened a letter: they never change, kept for the session.
const signatures = new Map<number, string>();

// The encoded payload, once its round has come.
export async function openLetter(letter: SealedLetter, getSignature: GetSignature): Promise<string> {
  let fetched: string | null = null;
  const cached = async (round: number) => signatures.get(round) ?? (fetched = await getSignature(round));

  const opened = await timelockDecrypt(letter.box, client(cached));

  if (fetched) {
    signatures.set(letter.round, fetched);
  }

  return opened.toString("utf8");
}
