import { FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import { PROFILE_COLUMNS } from "../accounts.js";
import { db } from "../database.js";
import { chatActor } from "../rooms.js";

export type AuthUser = FastifyRequest["user"];

// A session ends after this many days without being used; every use moves
// the end forward, so active devices stay logged in.
export const SESSION_TTL_DAYS = 30;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Reads the token from "Authorization: Bearer <token>".
export function getBearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;

  if (!authorization) {
    return null;
  }

  const [type, token] = authorization.split(" ");

  if (type !== "Bearer" || !token) {
    return null;
  }

  return token;
}

export type Session = {
  user: AuthUser;
  tokenHash: string;
};

export async function findSessionByHash(
  tokenHash: string,
): Promise<Session | null> {
  const result = await db.query(
    `
    SELECT
      users.id,
      users.username,
      users.created_at,
      users.username_changed_at,
      users.show_presence,
      users.read_receipts,
      ${PROFILE_COLUMNS}
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = $1
      AND sessions.expires_at > NOW()
    `,
    [tokenHash],
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  // For the list of devices, and to keep the session alive while it is
  // used; at most every few minutes per session.
  db.query(
    `
    UPDATE sessions
    SET last_used_at = NOW(),
        expires_at = GREATEST(expires_at, NOW() + make_interval(days => $2))
    WHERE token_hash = $1
      AND last_used_at < NOW() - INTERVAL '5 minutes'
    `,
    [tokenHash, SESSION_TTL_DAYS],
  ).catch(() => {});

  return { user: row, tokenHash };
}

export async function findUserByToken(
  token: string,
): Promise<AuthUser | null> {
  return (await findSessionByHash(hashToken(token)))?.user ?? null;
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = getBearerToken(request);

  if (!token) {
    return reply.status(401).send({
      error: request.headers.authorization
        ? "Invalid authorization header"
        : "Authorization token is required",
    });
  }

  const user = await findUserByToken(token);

  if (!user) {
    return reply.status(401).send({
      error: "Invalid or expired token",
    });
  }

  request.user = user;
  request.token = token;

  // In an anonymous room the user acts as their persona (rooms.ts), and
  // only on the routes that make sense there.
  const chatId = (request.params as { chatId?: string } | undefined)?.chatId;

  if (chatId) {
    const actor = await chatActor(chatId, user.id);

    if (actor.room) {
      if (!ROOM_ROUTES.has(`${request.method} ${request.routeOptions.url}`)) {
        return reply.status(403).send({ error: "This can't be done in an anonymous room" });
      }

      if (!actor.persona) {
        return reply.status(403).send({ error: "You are not in this room" });
      }

      request.user = { ...user, id: actor.persona.id, username: actor.persona.username, avatar_id: null, is_developer: false };
    }
  }
}

// The chat routes a room's persona may use: like a group's member without
// admin rights. Group management, keys and calls do not apply; deleting
// the room or pinning in it nobody may; leaving is POST /api/rooms/:id/leave.
const ROOM_ROUTES = new Set([
  "GET /api/chats/:chatId/messages",
  "POST /api/chats/:chatId/messages",
  "PATCH /api/chats/:chatId/messages/:messageId",
  "DELETE /api/chats/:chatId/messages/:messageId",
  "PUT /api/chats/:chatId/messages/:messageId/reaction",
  "POST /api/chats/:chatId/read",
  "PUT /api/chats/:chatId/settings",
  "GET /api/chats/:chatId/members",
  "GET /api/chats/:chatId/messages/:messageId/server-view",
  "GET /api/chats/:chatId/server-view",
]);
