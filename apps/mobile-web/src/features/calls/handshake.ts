import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes, toHex } from "../../crypto/crypto.ts";

// The Ostrich handshake: checking during a call that nobody is in the
// middle of it. Both devices make the same two silly sentences ("Sleepy
// flamingo juggles cacti") from the fingerprints of the certificates the
// call's audio is encrypted with. Each person reads their sentence aloud
// and picks the other's among four: a sentence that is not there means the
// two devices are not talking to each other but to someone between them.
// Picking among four makes people listen, instead of saying "yes, same".
//
//   code = SHA-256("ostrich/v1 call handshake" 0 call id 0 caller's
//          fingerprint 0 callee's fingerprint 0 caller's nonce 0 callee's
//          nonce)
//   the caller reads code[0..3], the callee code[4..7]: each byte mod 32
//   chooses an adjective, an animal, a verb and a thing (20 bits a sentence)
//
// The caller's offer commits to its nonce (SHA-256 of it), the callee's
// answer carries its own, and only then the caller reveals its nonce. So
// someone in the middle, who has to answer the caller before knowing the
// caller's nonce, cannot try certificates until the sentences match: they
// get one try, with a chance of 1 in a million.

const ADJECTIVES = [
  "sleepy", "brave", "fluffy", "grumpy", "shiny", "sneaky", "jolly", "tiny",
  "giant", "dizzy", "clever", "lazy", "noisy", "polite", "spicy", "fancy",
  "wobbly", "bouncy", "cosmic", "rusty", "velvet", "frosty", "sunny", "gentle",
  "wild", "cheeky", "royal", "silly", "mighty", "curious", "golden", "moody",
];

const ANIMALS: [string, string][] = [
  ["flamingo", "🦩"], ["penguin", "🐧"], ["octopus", "🐙"], ["raccoon", "🦝"],
  ["hedgehog", "🦔"], ["sloth", "🦥"], ["otter", "🦦"], ["llama", "🦙"],
  ["giraffe", "🦒"], ["koala", "🐨"], ["panda", "🐼"], ["fox", "🦊"],
  ["owl", "🦉"], ["tiger", "🐯"], ["zebra", "🦓"], ["camel", "🐫"],
  ["beaver", "🦫"], ["badger", "🦡"], ["parrot", "🦜"], ["turtle", "🐢"],
  ["dolphin", "🐬"], ["whale", "🐳"], ["kangaroo", "🦘"], ["hippo", "🦛"],
  ["rhino", "🦏"], ["bison", "🦬"], ["peacock", "🦚"], ["swan", "🦢"],
  ["lobster", "🦞"], ["unicorn", "🦄"], ["dragon", "🐉"], ["mammoth", "🦣"],
];

const VERBS = [
  "juggles", "paints", "collects", "bakes", "hugs", "chases", "sells", "steals",
  "polishes", "counts", "tickles", "plants", "carries", "knits", "serves", "hides",
  "launches", "guards", "sorts", "washes", "buys", "borrows", "tosses", "eats",
  "builds", "delivers", "wraps", "stacks", "rescues", "invents", "sniffs", "inspects",
];

const THINGS: [string, string][] = [
  ["cacti", "🌵"], ["pancakes", "🥞"], ["umbrellas", "☂️"], ["pineapples", "🍍"],
  ["rockets", "🚀"], ["teapots", "🫖"], ["balloons", "🎈"], ["crowns", "👑"],
  ["pizzas", "🍕"], ["guitars", "🎸"], ["donuts", "🍩"], ["lanterns", "🏮"],
  ["cookies", "🍪"], ["kites", "🪁"], ["bananas", "🍌"], ["trumpets", "🎺"],
  ["mushrooms", "🍄"], ["diamonds", "💎"], ["waffles", "🧇"], ["magnets", "🧲"],
  ["tacos", "🌮"], ["robots", "🤖"], ["snowmen", "⛄"], ["carrots", "🥕"],
  ["cherries", "🍒"], ["bells", "🔔"], ["books", "📚"], ["socks", "🧦"],
  ["candles", "🕯️"], ["planets", "🪐"], ["dumplings", "🥟"], ["cupcakes", "🧁"],
];

const WORDS = 32;

// Indexes of the adjective, animal, verb and thing.
export type Phrase = readonly [number, number, number, number];

export function phraseText([adjective, animal, verb, thing]: Phrase) {
  const first = ADJECTIVES[adjective];

  return `${first[0].toUpperCase()}${first.slice(1)} ${ANIMALS[animal][0]} ${VERBS[verb]} ${THINGS[thing][0]}`;
}

export function phraseEmoji([, animal, , thing]: Phrase) {
  return `${ANIMALS[animal][1]} ${THINGS[thing][1]}`;
}

export function samePhrase(a: Phrase, b: Phrase) {
  return a.every((word, i) => word === b[i]);
}

export type HandshakeInput = {
  callId: string;
  callerFingerprint: string;
  calleeFingerprint: string;
  // Hex.
  callerNonce: string;
  calleeNonce: string;
};

// The sentence each side reads aloud.
export function handshakePhrases(input: HandshakeInput): { caller: Phrase; callee: Phrase } {
  const code = sha256(
    new TextEncoder().encode(
      [
        "ostrich/v1 call handshake",
        input.callId,
        input.callerFingerprint.toUpperCase(),
        input.calleeFingerprint.toUpperCase(),
        input.callerNonce.toLowerCase(),
        input.calleeNonce.toLowerCase(),
      ].join("\0"),
    ),
  );
  const phrase = (at: number): Phrase => [
    code[at] % WORDS,
    code[at + 1] % WORDS,
    code[at + 2] % WORDS,
    code[at + 3] % WORDS,
  ];

  return { caller: phrase(0), callee: phrase(4) };
}

// The right sentence among three others, in a random order. The others
// share no word with it, so one word heard is enough to tell them apart.
export function phraseChoices(right: Phrase, random: (n: number) => Uint8Array = randomBytes): Phrase[] {
  const choices: Phrase[] = [right];

  while (choices.length < 4) {
    const bytes = random(4);
    const candidate: Phrase = [bytes[0] % WORDS, bytes[1] % WORDS, bytes[2] % WORDS, bytes[3] % WORDS];

    if (choices.every((other) => candidate.every((word, i) => word !== other[i]))) {
      choices.push(candidate);
    }
  }

  for (let i = choices.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1, random);
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }

  return choices;
}

// 0 ≤ n < limit, unbiased: bytes past the last whole multiple are skipped.
function randomBelow(limit: number, random: (n: number) => Uint8Array) {
  const top = 256 - (256 % limit);

  for (;;) {
    const byte = random(1)[0];

    if (byte < top) {
      return byte % limit;
    }
  }
}

// A nonce for the handshake (hex), and what the offer commits to.
export function newNonce() {
  return toHex(randomBytes(16));
}

export function commitment(nonce: string) {
  return toHex(sha256(new TextEncoder().encode(`ostrich/v1 call commit\0${nonce.toLowerCase()}`)));
}

// The certificate fingerprint of a session description ("a=fingerprint:
// sha-256 AB:CD:…"), or null if it has none.
export function fingerprintOf(sdp: string) {
  return /^a=fingerprint:sha-256 ([0-9A-F:]+)\s*$/im.exec(sdp)?.[1].toUpperCase() ?? null;
}
