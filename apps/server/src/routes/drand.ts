import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/auth.js";

// Sealed letters are time-locked to a round of drand's "quicknet" (a
// public randomness beacon, https://drand.love): the round's signature is
// the key that opens them, published by drand when the round comes. Apps
// get it here, so drand does not see their addresses; they check it
// against the network's public key built into them, so the server cannot
// make one up, only withhold it.
export const QUICKNET = {
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  genesisTime: 1692803367,
  period: 3,
};

const RELAYS = [
  "https://api.drand.sh",
  "https://api2.drand.sh",
  "https://api3.drand.sh",
  "https://drand.cloudflare.com",
];

// The round being published at `time` (ms).
export function currentRound(time = Date.now()) {
  return Math.floor((time / 1000 - QUICKNET.genesisTime) / QUICKNET.period) + 1;
}

// Signatures never change: kept, up to this many.
const CACHE_SIZE = 10_000;
const cache = new Map<number, string>();

async function fetchSignature(round: number): Promise<string | null> {
  for (const relay of RELAYS) {
    try {
      const response = await fetch(`${relay}/${QUICKNET.hash}/public/${round}`, {
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        continue;
      }

      const beacon = (await response.json()) as { round?: unknown; signature?: unknown };

      if (beacon.round === round && typeof beacon.signature === "string" && /^[0-9a-f]{96}$/.test(beacon.signature)) {
        return beacon.signature;
      }
    } catch {
      // The next relay.
    }
  }

  return null;
}

export default async function drandRoutes(server: FastifyInstance) {
  server.get<{ Params: { round: number } }>(
    "/api/drand/rounds/:round",
    {
      preHandler: authenticate,
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        params: {
          type: "object",
          required: ["round"],
          properties: { round: { type: "integer", minimum: 1 } },
        },
      },
    },
    async (request, reply) => {
      const { round } = request.params;

      if (round > currentRound()) {
        return reply.status(425).send({ error: "This round has not come yet" });
      }

      let signature = cache.get(round) ?? null;

      if (!signature) {
        signature = await fetchSignature(round);

        if (!signature) {
          return reply.status(502).send({ error: "drand could not be reached: try again later" });
        }

        if (cache.size >= CACHE_SIZE) {
          cache.delete(cache.keys().next().value!);
        }

        cache.set(round, signature);
      }

      return { round, signature };
    },
  );
}
