import { FastifyInstance } from "fastify";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "../attachments.js";
import { db } from "../database.js";
import { dueAt, MAX_DAYS, MAX_MESSAGES, MIN_DAYS } from "../disappear.js";
import { groupEpochOf, isEncryptedMessage, MAX_MESSAGE_LENGTH, MESSAGE_PATTERN } from "../messages.js";
import { authenticate } from "../middleware/auth.js";
import { sendToUserSockets } from "../realtime.js";

// "If I disappear" (disappear.ts): the user's switch and the messages it
// sends.
const changeRateLimit = { rateLimit: { max: 30, timeWindow: "1 minute" } };

const UUID = { type: "string", format: "uuid" } as const;

async function status(userId: string) {
  const [state, messages] = await Promise.all([
    db.query(
      "SELECT days, last_active_at, warned, triggered_at FROM disappear_switches WHERE user_id = $1",
      [userId],
    ),
    db.query(
      `
      SELECT d.id, d.chat_id, d.content, d.attachments, d.created_at,
             -- Not sendable as it is: no longer a member, or a group's key
             -- changed since it was encrypted (to be written again).
             (
               cm.user_id IS NULL
               OR (c.type = 'group' AND (c.rotation_needed OR
                   COALESCE(substring(d.content from '^e3:([0-9]+):')::int, -1) <> c.key_epoch))
             ) AS stale
      FROM disappear_messages d
      JOIN chats c ON c.id = d.chat_id
      LEFT JOIN chat_members cm ON cm.chat_id = d.chat_id AND cm.user_id = d.user_id
      WHERE d.user_id = $1
      ORDER BY d.created_at
      `,
      [userId],
    ),
  ]);

  const row = state.rows[0];

  return {
    switch: row
      ? {
          days: row.days,
          last_active_at: row.last_active_at,
          due_at: row.triggered_at ? null : dueAt(row.last_active_at, row.days),
          warned: row.warned,
          triggered_at: row.triggered_at,
        }
      : null,
    messages: messages.rows,
  };
}

export default async function disappearRoutes(server: FastifyInstance) {
  server.get("/api/disappear", { preHandler: authenticate }, async (request) => status(request.user.id));

  // ON, or a new period: the days start again.
  server.put<{ Body: { days: number } }>(
    "/api/disappear",
    {
      preHandler: authenticate,
      config: changeRateLimit,
      schema: {
        body: {
          type: "object",
          required: ["days"],
          properties: { days: { type: "integer", minimum: MIN_DAYS, maximum: MAX_DAYS } },
        },
      },
    },
    async (request) => {
      await db.query(
        `
        INSERT INTO disappear_switches (user_id, days) VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE
        SET days = EXCLUDED.days, last_active_at = NOW(), warned = 0, triggered_at = NULL, updated_at = NOW()
        `,
        [request.user.id, request.body.days],
      );
      sendToUserSockets(request.user.id, { type: "disappear" });

      return status(request.user.id);
    },
  );

  // OFF: the switch and its messages go.
  server.delete("/api/disappear", { preHandler: authenticate, config: changeRateLimit }, async (request) => {
    await db.query("DELETE FROM disappear_messages WHERE user_id = $1", [request.user.id]);
    await db.query("DELETE FROM disappear_switches WHERE user_id = $1", [request.user.id]);
    sendToUserSockets(request.user.id, { type: "disappear" });

    return status(request.user.id);
  });

  // "I'm here": the apps call it when they are opened. `was_warned`: the
  // warning sent before (the app says the days start again).
  server.post(
    "/api/disappear/alive",
    { preHandler: authenticate, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request) => {
      const result = await db.query(
        `
        UPDATE disappear_switches s SET last_active_at = NOW(), warned = 0
        FROM (SELECT user_id, warned FROM disappear_switches WHERE user_id = $1) before
        WHERE s.user_id = before.user_id AND s.triggered_at IS NULL
        RETURNING before.warned AS was_warned
        `,
        [request.user.id],
      );

      const wasWarned = result.rows[0]?.was_warned ?? 0;

      if (wasWarned > 0) {
        sendToUserSockets(request.user.id, { type: "disappear" });
      }

      return { ...(await status(request.user.id)), was_warned: wasWarned };
    },
  );

  // A message to send, new or changed (encrypted for its chat, bound to
  // its id like any message).
  server.put<{ Params: { id: string }; Body: { chat_id: string; content: string; attachments?: string[] } }>(
    "/api/disappear/messages/:id",
    {
      preHandler: authenticate,
      config: changeRateLimit,
      schema: {
        params: { type: "object", required: ["id"], properties: { id: UUID } },
        body: {
          type: "object",
          required: ["chat_id", "content"],
          properties: {
            chat_id: UUID,
            content: { type: "string", maxLength: MAX_MESSAGE_LENGTH, pattern: MESSAGE_PATTERN },
            attachments: {
              type: "array",
              maxItems: MAX_ATTACHMENTS_PER_MESSAGE,
              uniqueItems: true,
              items: UUID,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = request.user.id;
      const { id } = request.params;
      const { chat_id: chatId, content } = request.body;
      const attachments = request.body.attachments ?? [];

      if (!isEncryptedMessage(content)) {
        return reply.status(400).send({ error: "The message must be encrypted" });
      }

      const check = await db.query(
        `
        SELECT
          (SELECT type FROM chats WHERE id = $2) AS type,
          (SELECT key_epoch FROM chats WHERE id = $2) AS key_epoch,
          EXISTS (SELECT 1 FROM chat_members WHERE chat_id = $2 AND user_id = $1) AS member,
          EXISTS (SELECT 1 FROM disappear_switches WHERE user_id = $1) AS switch_on,
          (SELECT COUNT(*)::int FROM disappear_messages WHERE user_id = $1 AND id <> $3) AS others,
          EXISTS (SELECT 1 FROM disappear_messages WHERE id = $3 AND user_id <> $1)
            OR EXISTS (SELECT 1 FROM messages WHERE id = $3) AS taken,
          -- The files: the user's uploads, not sent nor waiting in another one.
          (
            SELECT COUNT(*) FROM attachments a
            WHERE a.id = ANY($4::uuid[]) AND a.uploader_id = $1 AND a.message_id IS NULL AND a.chat_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM disappear_messages d WHERE d.id <> $3 AND a.id = ANY(d.attachments))
          ) = cardinality($4::uuid[]) AS files_free
        `,
        [userId, chatId, id, attachments],
      );

      const row = check.rows[0];
      const epoch = groupEpochOf(content);

      const problem = !row.switch_on
        ? "Turn on \"If I disappear\" first"
        : !row.member || row.type === "saved"
          ? "Choose one of your chats or groups"
          : row.taken
            ? "A message with this id already exists"
            : row.others >= MAX_MESSAGES
              ? `Up to ${MAX_MESSAGES} messages`
              : !row.files_free
                ? "A file is missing or was already sent"
                : (row.type === "group" ? epoch !== row.key_epoch : epoch !== null)
                  ? "The group's key has changed: try again"
                  : null;

      if (problem) {
        return reply.status(400).send({ error: problem });
      }

      await db.query(
        `
        INSERT INTO disappear_messages (id, user_id, chat_id, content, attachments)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE
        SET chat_id = EXCLUDED.chat_id, content = EXCLUDED.content, attachments = EXCLUDED.attachments
        WHERE disappear_messages.user_id = $2
        `,
        [id, userId, chatId, content, attachments],
      );

      return status(userId);
    },
  );

  server.delete<{ Params: { id: string } }>(
    "/api/disappear/messages/:id",
    {
      preHandler: authenticate,
      config: changeRateLimit,
      schema: { params: { type: "object", required: ["id"], properties: { id: UUID } } },
    },
    async (request) => {
      await db.query("DELETE FROM disappear_messages WHERE id = $1 AND user_id = $2", [
        request.params.id,
        request.user.id,
      ]);

      return status(request.user.id);
    },
  );
}
