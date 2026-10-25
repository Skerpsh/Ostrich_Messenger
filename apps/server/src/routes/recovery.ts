import { FastifyInstance } from "fastify";
import argon2 from "argon2";
import crypto from "node:crypto";
import { db, withTransaction } from "../database.js";
import { AUTH_KEY_PATTERN, authKeyMatches } from "../accounts.js";
import { authenticate } from "../middleware/auth.js";
import {
  ACTIVE_REQUEST,
  announceRecovery,
  cancelActiveRequests,
  MAX_GUARDIANS,
  MAX_REQUESTS_PER_DAY,
  MIN_GUARDIANS,
  notifyNewGuardians,
  notifyNewRequest,
  recoveryAudience,
  RECOVERY_DELAY_MS,
  REQUEST_TTL_MS,
  requestState,
} from "../recovery.js";
import {
  authRateLimit,
  clearFailedLogins,
  clientName,
  dummyPasswordHash,
  loginBlocked,
  recordFailedLogin,
  TOO_MANY_ATTEMPTS,
} from "./auth.js";

// Recovery through friends (see ../recovery.ts for the whole scheme).

const UUID = { type: "string", format: "uuid" } as const;
const KEY = { type: "string", pattern: "^[A-Za-z0-9+/]{43}=$" } as const;
// nonce + a share (an OstrichID's bytes and its x) + tag, with room.
const SEALED = { type: "string", maxLength: 400, pattern: "^[A-Za-z0-9+/]+={0,2}$" } as const;

const idParams = { type: "object", required: ["id"], properties: { id: UUID } } as const;

const changeRateLimit = { rateLimit: { max: 30, timeWindow: "1 minute" } };
// The recovering device asks every few seconds while it waits.
const pollRateLimit = { rateLimit: { max: 60, timeWindow: "1 minute" } };

const hashSecret = (secret: string) => crypto.createHash("sha256").update(secret).digest("hex");

const NO_REQUEST = "This request is over: it was cancelled, used or has expired";

// The owner's view: the guardians and any request going.
async function ownerStatus(userId: string) {
  const [setup, requests] = await Promise.all([
    db.query(
      `
      SELECT st.id, st.threshold, st.created_at,
             COALESCE(json_agg(json_build_object(
               'id', users.id, 'username', users.username,
               'avatar_id', (SELECT avatars.id FROM avatars WHERE avatars.user_id = users.id),
               'is_developer', users.is_developer
             ) ORDER BY LOWER(users.username)) FILTER (WHERE users.id IS NOT NULL), '[]') AS guardians
      FROM recovery_setups st
      LEFT JOIN recovery_shares s ON s.setup_id = st.id
      LEFT JOIN users ON users.id = s.guardian_id
      WHERE st.user_id = $1
      GROUP BY st.user_id
      `,
      [userId],
    ),
    db.query(
      `
      SELECT r.id, r.public_key, r.client, r.created_at, r.ready_at, r.expires_at,
             (SELECT COUNT(*)::int FROM recovery_approvals a WHERE a.request_id = r.id) AS approvals
      FROM recovery_requests r
      WHERE r.user_id = $1 AND ${ACTIVE_REQUEST}
      ORDER BY r.created_at DESC
      `,
      [userId],
    ),
  ]);

  return { setup: setup.rows[0] ?? null, requests: requests.rows };
}

type ShareBody = { guardian_id: string; sealed: string; sealer_public: string };

export default async function recoveryRoutes(server: FastifyInstance) {
  // --- the owner ---

  server.get("/api/recovery", { preHandler: authenticate }, async (request) => ownerStatus(request.user.id));

  // Sets the guardians (replacing any before): the shares, each sealed for
  // its guardian on the device. `auth_key`: the OstrichID they are of.
  server.put<{ Body: { id: string; threshold: number; auth_key: string; shares: ShareBody[] } }>(
    "/api/recovery",
    {
      preHandler: authenticate,
      config: changeRateLimit,
      schema: {
        body: {
          type: "object",
          required: ["id", "threshold", "auth_key", "shares"],
          properties: {
            id: UUID,
            threshold: { type: "integer", minimum: 2, maximum: MAX_GUARDIANS },
            auth_key: { type: "string", pattern: AUTH_KEY_PATTERN },
            shares: {
              type: "array",
              minItems: MIN_GUARDIANS,
              maxItems: MAX_GUARDIANS,
              items: {
                type: "object",
                required: ["guardian_id", "sealed", "sealer_public"],
                properties: { guardian_id: UUID, sealed: SEALED, sealer_public: KEY },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const { id, threshold, auth_key, shares } = request.body;
      const guardians = shares.map((share) => share.guardian_id);

      if (await loginBlocked(request, request.user.username)) {
        return reply.status(429).send({ error: TOO_MANY_ATTEMPTS });
      }

      const owner = await db.query("SELECT auth_key_hash FROM users WHERE id = $1", [userId]);

      if (!owner.rows[0]?.auth_key_hash || !authKeyMatches(auth_key, owner.rows[0].auth_key_hash)) {
        await recordFailedLogin(request, request.user.username);

        return reply.status(403).send({ error: "Wrong OstrichID" });
      }

      // Friends: users with a direct chat with the owner.
      const friends = await db.query(
        `
        SELECT COUNT(DISTINCT other.user_id)::int AS count
        FROM chat_members me
        JOIN chats ON chats.id = me.chat_id AND chats.type = 'direct'
        JOIN chat_members other ON other.chat_id = me.chat_id AND other.user_id <> me.user_id
        JOIN users ON users.id = other.user_id AND users.public_key IS NOT NULL
        WHERE me.user_id = $1 AND other.user_id = ANY($2::uuid[])
        `,
        [userId, guardians],
      );

      const problem =
        new Set(guardians).size !== guardians.length
          ? "Each guardian once"
          : guardians.includes(userId)
            ? "You cannot be your own guardian"
            : threshold > guardians.length
              ? "The shares needed cannot be more than the guardians"
              : friends.rows[0].count !== guardians.length
                ? "Guardians must be people you have a chat with"
                : null;

      if (problem) {
        return reply.status(400).send({ error: problem });
      }

      const before = await recoveryAudience(db, userId);

      await withTransaction(async (client) => {
        // A request going was for the old shares.
        await cancelActiveRequests(client, userId);
        await client.query("DELETE FROM recovery_setups WHERE user_id = $1", [userId]);
        await client.query("INSERT INTO recovery_setups (user_id, id, threshold) VALUES ($1, $2, $3)", [
          userId,
          id,
          threshold,
        ]);

        for (const share of shares) {
          await client.query(
            "INSERT INTO recovery_shares (setup_id, guardian_id, sealed, sealer_public) VALUES ($1, $2, $3, $4)",
            [id, share.guardian_id, share.sealed, share.sealer_public],
          );
        }
      });

      await clearFailedLogins(request, request.user.username);
      notifyNewGuardians(
        request.user.username,
        guardians.filter((guardian) => !before.includes(guardian)),
      );
      announceRecovery([...before, ...guardians]);

      return ownerStatus(userId);
    },
  );

  // No guardians any more.
  server.delete("/api/recovery", { preHandler: authenticate, config: changeRateLimit }, async (request) => {
    const userId = request.user.id;
    const before = await recoveryAudience(db, userId);

    await withTransaction(async (client) => {
      await cancelActiveRequests(client, userId);
      await client.query("DELETE FROM recovery_setups WHERE user_id = $1", [userId]);
    });
    announceRecovery(before);

    return ownerStatus(userId);
  });

  // "It's not me": cancels a request from any of the owner's devices.
  server.delete<{ Params: { id: string } }>(
    "/api/recovery/requests/:id",
    { preHandler: authenticate, config: changeRateLimit, schema: { params: idParams } },
    async (request) => {
      const userId = request.user.id;

      await db.query(
        `UPDATE recovery_requests r SET cancelled_at = NOW() WHERE r.id = $1 AND r.user_id = $2 AND ${ACTIVE_REQUEST}`,
        [request.params.id, userId],
      );
      announceRecovery(await recoveryAudience(db, userId));

      return ownerStatus(userId);
    },
  );

  // --- the guardians ---

  // Whose shares the user keeps, and their requests going.
  server.get("/api/recovery/guarding", { preHandler: authenticate }, async (request) => {
    const result = await db.query(
      `
      SELECT st.id AS setup_id, st.threshold,
             (SELECT COUNT(*)::int FROM recovery_shares x WHERE x.setup_id = st.id) AS total,
             s.sealed, s.sealer_public,
             json_build_object('id', users.id, 'username', users.username,
               'avatar_id', (SELECT avatars.id FROM avatars WHERE avatars.user_id = users.id),
               'is_developer', users.is_developer) AS owner,
             (
               SELECT json_build_object('id', r.id, 'public_key', r.public_key, 'client', r.client,
                        'created_at', r.created_at, 'ready_at', r.ready_at,
                        'approved', EXISTS (SELECT 1 FROM recovery_approvals a
                                            WHERE a.request_id = r.id AND a.guardian_id = s.guardian_id))
               FROM recovery_requests r
               WHERE r.setup_id = st.id AND ${ACTIVE_REQUEST}
               ORDER BY r.created_at DESC LIMIT 1
             ) AS request
      FROM recovery_shares s
      JOIN recovery_setups st ON st.id = s.setup_id
      JOIN users ON users.id = st.user_id
      WHERE s.guardian_id = $1
      ORDER BY LOWER(users.username)
      `,
      [request.user.id],
    );

    return { guarding: result.rows };
  });

  // The guardian's share, sealed again for the request's key (after they
  // compared its code with the one asking).
  server.post<{ Params: { id: string }; Body: { sealed: string; sealer_public: string } }>(
    "/api/recovery/requests/:id/approve",
    {
      preHandler: authenticate,
      config: changeRateLimit,
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["sealed", "sealer_public"],
          properties: { sealed: SEALED, sealer_public: KEY },
        },
      },
    },
    async (request, reply) => {
      const result = await db.query(
        `
        INSERT INTO recovery_approvals (request_id, guardian_id, sealed, sealer_public)
        SELECT r.id, s.guardian_id, $3, $4
        FROM recovery_requests r
        JOIN recovery_shares s ON s.setup_id = r.setup_id AND s.guardian_id = $2
        WHERE r.id = $1 AND ${ACTIVE_REQUEST}
        ON CONFLICT (request_id, guardian_id) DO UPDATE
        SET sealed = EXCLUDED.sealed, sealer_public = EXCLUDED.sealer_public
        RETURNING (SELECT user_id FROM recovery_requests WHERE id = $1) AS owner_id
        `,
        [request.params.id, request.user.id, request.body.sealed, request.body.sealer_public],
      );

      if (!result.rows[0]) {
        return reply.status(404).send({ error: NO_REQUEST });
      }

      announceRecovery(await recoveryAudience(db, result.rows[0].owner_id));

      return { approved: true };
    },
  );

  // --- the device recovering (not logged in) ---

  // Asks with the username, the password and a one-time public key; gets
  // the request's secret, to fetch the shares with later.
  server.post<{ Body: { username: string; password: string; public_key: string } }>(
    "/api/recovery/requests",
    {
      config: authRateLimit,
      schema: {
        body: {
          type: "object",
          required: ["username", "password", "public_key"],
          properties: {
            username: { type: "string", maxLength: 64 },
            password: { type: "string", maxLength: 128 },
            public_key: KEY,
          },
        },
      },
    },
    async (request, reply) => {
      const { password, public_key } = request.body;
      const username = request.body.username.replace(/^@/, "");

      // Shares the login's count of wrong passwords.
      if (await loginBlocked(request, username)) {
        return reply.status(429).send({ error: TOO_MANY_ATTEMPTS });
      }

      const found = await db.query(
        `
        SELECT users.id, users.username, users.password_hash, st.id AS setup_id, st.threshold,
               (SELECT COUNT(*)::int FROM recovery_shares s WHERE s.setup_id = st.id) AS total
        FROM users
        LEFT JOIN recovery_setups st ON st.user_id = users.id
        WHERE LOWER(users.username) = LOWER($1)
        `,
        [username],
      );

      const user = found.rows[0];
      const passwordValid = await argon2.verify(user ? user.password_hash : await dummyPasswordHash, password);

      if (!user || !passwordValid) {
        await recordFailedLogin(request, username);

        return reply.status(401).send({ error: "Invalid username or password" });
      }

      await clearFailedLogins(request, username);

      if (!user.setup_id) {
        return reply.status(404).send({
          error: "This account has no guardians: it can only be opened with its OstrichID or from a logged-in device",
          code: "no_guardians",
        });
      }

      const secret = crypto.randomBytes(32).toString("hex");
      const now = Date.now();

      const created = await withTransaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('recovery:' || $1::text))", [user.id]);

        const recent = await client.query(
          "SELECT COUNT(*)::int AS count FROM recovery_requests WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 day'",
          [user.id],
        );

        if (recent.rows[0].count >= MAX_REQUESTS_PER_DAY) {
          return null;
        }

        // One at a time: a new one (e.g. the first device was lost)
        // replaces the one going.
        await cancelActiveRequests(client, user.id);

        const result = await client.query(
          `
          INSERT INTO recovery_requests (user_id, setup_id, secret_hash, public_key, client, ready_at, expires_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, ready_at, expires_at
          `,
          [
            user.id,
            user.setup_id,
            hashSecret(secret),
            public_key,
            clientName(request),
            new Date(now + RECOVERY_DELAY_MS),
            new Date(now + REQUEST_TTL_MS),
          ],
        );

        return result.rows[0];
      });

      if (!created) {
        return reply.status(429).send({
          error: `Up to ${MAX_REQUESTS_PER_DAY} recovery requests a day: try again tomorrow`,
        });
      }

      const audience = await recoveryAudience(db, user.id);

      notifyNewRequest(user.id, user.username, audience.slice(1));
      announceRecovery(audience);

      return reply.status(201).send({
        id: created.id,
        secret,
        user_id: user.id,
        username: user.username,
        ready_at: created.ready_at,
        expires_at: created.expires_at,
        threshold: user.threshold,
        total: user.total,
      });
    },
  );

  // How the request is going; once ready, the approvals (each a share
  // sealed for the request's key) and the account's encrypted private
  // key, so the device can check which shares give the right OstrichID.
  server.post<{ Params: { id: string }; Body: { secret: string } }>(
    "/api/recovery/requests/:id/status",
    {
      config: pollRateLimit,
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["secret"],
          properties: { secret: { type: "string", pattern: "^[0-9a-f]{64}$" } },
        },
      },
    },
    async (request, reply) => {
      const found = await db.query(
        `
        SELECT r.ready_at, r.expires_at, r.cancelled_at, r.completed_at, r.secret_hash,
               st.threshold, users.encrypted_private_key,
               (SELECT COUNT(*)::int FROM recovery_shares s WHERE s.setup_id = st.id) AS total
        FROM recovery_requests r
        JOIN users ON users.id = r.user_id
        LEFT JOIN recovery_setups st ON st.id = r.setup_id
        WHERE r.id = $1
        `,
        [request.params.id],
      );

      const row = found.rows[0];

      if (
        !row ||
        !crypto.timingSafeEqual(Buffer.from(hashSecret(request.body.secret), "hex"), Buffer.from(row.secret_hash, "hex"))
      ) {
        return reply.status(404).send({ error: "Recovery request not found" });
      }

      const approvals = await db.query(
        "SELECT guardian_id, sealed, sealer_public FROM recovery_approvals WHERE request_id = $1",
        [request.params.id],
      );

      const state = row.threshold
        ? requestState(row, approvals.rows.length, row.threshold)
        : row.completed_at
          ? "completed"
          : "cancelled";

      return {
        state,
        ready_at: row.ready_at,
        expires_at: row.expires_at,
        approvals: approvals.rows.length,
        threshold: row.threshold ?? null,
        total: row.total ?? null,
        ...(state === "ready"
          ? { shares: approvals.rows, encrypted_private_key: row.encrypted_private_key }
          : {}),
      };
    },
  );
}
