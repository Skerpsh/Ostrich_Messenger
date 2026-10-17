import { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { db } from "../database.js";
import { accountView } from "../accounts.js";
import { authenticate } from "../middleware/auth.js";
import { clientName, createSession, keysView, USER_COLUMNS } from "./auth.js";

// Logging in on a new device with a QR code, without the password or the
// OstrichID:
//   1. the new device makes a one-time key pair and asks for a link
//      (POST /api/device-links); it shows the link's id and its public key
//      as a QR code and keeps the secret it got;
//   2. a logged-in device scans it, sees what kind of device asks
//      (GET …/:id) and approves: it sends the account's private key
//      encrypted for the public key from the QR code (POST …/:id/approve);
//   3. the new device, asking with its secret (POST …/:id/session), gets a
//      new session and the encrypted key, which only it can open.
// The server never sees the private key. Whoever only sees the QR code
// gets nothing: the session goes to the holder of the secret.

const LINK_TTL_MS = 3 * 60 * 1000;
const KEY_PATTERN = "^[A-Za-z0-9+/]{43}=$";
const SEALED_PATTERN = "^[A-Za-z0-9+/]+={0,2}$";

const linkRateLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };
// The new device asks every couple of seconds while its QR code is shown.
const pollRateLimit = { rateLimit: { max: 60, timeWindow: "1 minute" } };

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
};

const hashSecret = (secret: string) => crypto.createHash("sha256").update(secret).digest("hex");

export default async function deviceLinksRoutes(server: FastifyInstance) {
  server.post(
    "/api/device-links",
    { config: linkRateLimit },
    async (request) => {
      await db.query("DELETE FROM device_links WHERE expires_at < NOW()");

      const id = crypto.randomUUID();
      const secret = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + LINK_TTL_MS);

      await db.query(
        `
        INSERT INTO device_links (id, secret_hash, client, expires_at)
        VALUES ($1, $2, $3, $4)
        `,
        [id, hashSecret(secret), clientName(request), expiresAt],
      );

      return { id, secret, expires_at: expiresAt.toISOString() };
    },
  );

  // What the approving device shows before asking.
  server.get<{ Params: { id: string } }>(
    "/api/device-links/:id",
    { preHandler: authenticate, schema: { params: idParams }, config: linkRateLimit },
    async (request, reply) => {
      const result = await db.query(
        `
        SELECT client, created_at
        FROM device_links
        WHERE id = $1 AND user_id IS NULL AND expires_at > NOW()
        `,
        [request.params.id],
      );

      if (!result.rows[0]) {
        return reply.status(404).send({ error: "This QR code has expired. Show a new one." });
      }

      return { client: result.rows[0].client, created_at: result.rows[0].created_at };
    },
  );

  server.post<{ Params: { id: string }; Body: { sealed_key: string; public_key: string } }>(
    "/api/device-links/:id/approve",
    {
      preHandler: authenticate,
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["sealed_key", "public_key"],
          additionalProperties: false,
          properties: {
            sealed_key: { type: "string", maxLength: 200, pattern: SEALED_PATTERN },
            public_key: { type: "string", pattern: KEY_PATTERN },
          },
        },
      },
      config: linkRateLimit,
    },
    async (request, reply) => {
      // Once only.
      const result = await db.query(
        `
        UPDATE device_links
        SET user_id = $2, sealed_key = $3, sealer_public_key = $4
        WHERE id = $1 AND user_id IS NULL AND expires_at > NOW()
        RETURNING id
        `,
        [request.params.id, request.user.id, request.body.sealed_key, request.body.public_key],
      );

      if (!result.rows[0]) {
        return reply.status(404).send({ error: "This QR code has expired. Show a new one." });
      }

      return { message: "Device linked" };
    },
  );

  // The new device: "pending" until approved, then the session (once).
  server.post<{ Params: { id: string }; Body: { secret: string } }>(
    "/api/device-links/:id/session",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["secret"],
          additionalProperties: false,
          properties: { secret: { type: "string", pattern: "^[0-9a-f]{64}$" } },
        },
      },
      config: pollRateLimit,
    },
    async (request, reply) => {
      const { id } = request.params;
      const secretHash = hashSecret(request.body.secret);

      const taken = await db.query(
        `
        DELETE FROM device_links
        WHERE id = $1 AND secret_hash = $2 AND user_id IS NOT NULL AND expires_at > NOW()
        RETURNING user_id, sealed_key, sealer_public_key, client
        `,
        [id, secretHash],
      );

      const link = taken.rows[0];

      if (!link) {
        const pending = await db.query(
          "SELECT 1 FROM device_links WHERE id = $1 AND secret_hash = $2 AND expires_at > NOW()",
          [id, secretHash],
        );

        return pending.rows[0]
          ? { status: "pending" }
          : reply.status(404).send({ error: "This QR code has expired" });
      }

      const users = await db.query(
        `
        SELECT ${USER_COLUMNS}, public_key, encrypted_private_key
        FROM users
        WHERE id = $1
        `,
        [link.user_id],
      );

      const user = users.rows[0];

      if (!user?.public_key) {
        return reply.status(404).send({ error: "This QR code has expired" });
      }

      const token = await createSession(user.id, link.client);

      return {
        status: "approved",
        token,
        user: accountView(user),
        keys: keysView(user),
        sealed_key: link.sealed_key,
        sealer_public_key: link.sealer_public_key,
      };
    },
  );
}
