import { FastifyInstance } from "fastify";
import { db } from "../database.js";
import { deliveredTo } from "../messages.js";
import { authenticate } from "../middleware/auth.js";

// "What the server sees": the rows the database keeps about a message or
// a chat, as they are stored, so that clients can show them unchanged.
// Only what the member could already get, and of the other members only
// what is shared with them anyway (not their read positions or settings).
const viewRateLimit = {
  rateLimit: {
    max: 60,
    timeWindow: "1 minute",
  },
};

const UUID = { type: "string", format: "uuid" } as const;

// The member's row, or null; in a group, members see only the messages
// since they joined, here too.
async function membership(chatId: string, userId: string) {
  const result = await db.query(
    `
    SELECT chat_members.joined_at, chat_members.last_read_at, chat_members.pinned_at,
           chat_members.muted, chat_members.hidden, chat_members.cleared_at,
           chat_members.role, chats.type
    FROM chat_members
    JOIN chats ON chats.id = chat_members.chat_id
    WHERE chat_members.chat_id = $1 AND chat_members.user_id = $2
    `,
    [chatId, userId],
  );

  return result.rows[0] ?? null;
}

export default async function serverViewRoutes(server: FastifyInstance) {
  // A MESSAGE: its row, its files (size only), reactions and mentions.
  server.get<{ Params: { chatId: string; messageId: string } }>(
    "/api/chats/:chatId/messages/:messageId/server-view",
    {
      preHandler: authenticate,
      config: viewRateLimit,
      schema: {
        params: {
          type: "object",
          required: ["chatId", "messageId"],
          properties: { chatId: UUID, messageId: UUID },
        },
      },
    },
    async (request, reply) => {
      const { chatId, messageId } = request.params;
      const member = await membership(chatId, request.user.id);

      if (!member) {
        return reply.status(403).send({ error: "You are not a member of this chat" });
      }

      const message = await db.query(
        `
        SELECT m.id, m.chat_id, m.sender_id, sender.username AS sender_username,
               m.kind, m.content, LENGTH(m.content) AS content_length,
               m.reply_to_id, m.created_at, m.edited_at, m.deliver_at
        FROM messages m
        JOIN users sender ON sender.id = m.sender_id
        WHERE m.id = $1 AND m.chat_id = $2
          AND ($3::text <> 'group' OR m.created_at >= $4)
          AND ${deliveredTo("m", "$5")}
        `,
        [messageId, chatId, member.type, member.joined_at, request.user.id],
      );

      if (message.rows.length === 0) {
        return reply.status(404).send({ error: "Message not found in this chat" });
      }

      const [attachments, reactions, mentions] = await Promise.all([
        db.query(
          "SELECT id, size, created_at FROM attachments WHERE message_id = $1 ORDER BY created_at, id",
          [messageId],
        ),
        db.query(
          "SELECT emoji, user_id, created_at FROM message_reactions WHERE message_id = $1 ORDER BY created_at",
          [messageId],
        ),
        db.query("SELECT user_id FROM message_mentions WHERE message_id = $1", [messageId]),
      ]);

      return {
        message: message.rows[0],
        attachments: attachments.rows,
        reactions: reactions.rows,
        mentions: mentions.rows.map((row) => row.user_id),
      };
    },
  );

  // A CHAT: its row, its members, the user's own settings in it and how
  // much it holds.
  server.get<{ Params: { chatId: string } }>(
    "/api/chats/:chatId/server-view",
    {
      preHandler: authenticate,
      config: viewRateLimit,
      schema: {
        params: { type: "object", required: ["chatId"], properties: { chatId: UUID } },
      },
    },
    async (request, reply) => {
      const { chatId } = request.params;
      const member = await membership(chatId, request.user.id);

      if (!member) {
        return reply.status(403).send({ error: "You are not a member of this chat" });
      }

      const [chat, members, stats] = await Promise.all([
        db.query(
          `
          SELECT id, type, created_at, updated_at, encrypted_info, key_epoch, pinned_message_id
          FROM chats
          WHERE id = $1
          `,
          [chatId],
        ),
        db.query(
          `
          SELECT chat_members.user_id, users.username, chat_members.role, chat_members.joined_at
          FROM chat_members
          JOIN users ON users.id = chat_members.user_id
          WHERE chat_members.chat_id = $1
          ORDER BY chat_members.joined_at, users.username
          `,
          [chatId],
        ),
        db.query(
          `
          SELECT
            (SELECT COUNT(*)::int FROM messages m WHERE m.chat_id = $1 AND ${deliveredTo("m", "$2")}) AS messages,
            files.count AS files,
            files.bytes AS file_bytes,
            (SELECT COUNT(*)::int FROM group_keys WHERE chat_id = $1) AS group_keys,
            EXISTS (SELECT 1 FROM group_invites WHERE chat_id = $1) AS invite_link,
            (SELECT COUNT(*)::int FROM group_join_requests WHERE chat_id = $1) AS join_requests
          FROM (
            -- Files of older messages have no chat_id, only their message.
            SELECT COUNT(*)::int AS count, COALESCE(SUM(a.size), 0)::bigint AS bytes
            FROM attachments a
            LEFT JOIN messages m ON m.id = a.message_id
            WHERE a.chat_id = $1 OR (m.chat_id = $1 AND ${deliveredTo("m", "$2")})
          ) files
          `,
          [chatId, request.user.id],
        ),
      ]);

      const { type: _type, ...me } = member;

      return {
        chat: chat.rows[0],
        members: members.rows,
        me,
        stats: { ...stats.rows[0], file_bytes: Number(stats.rows[0].file_bytes) },
      };
    },
  );
}
