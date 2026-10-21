import { FastifyInstance } from "fastify";
import { iceServers } from "../calls.js";
import { authenticate } from "../middleware/auth.js";

export default async function callsRoutes(server: FastifyInstance) {
  // GET the STUN/TURN servers for a call, with a TURN login that expires
  // (calls.ts). The apps ask before each call.
  server.get(
    "/api/calls/ice-servers",
    {
      preHandler: authenticate,
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
    },
    async (request) => iceServers(request.user.id),
  );
}
