import { access, copyFile, rename, unlink } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import crypto from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FastifyInstance } from "fastify";
import {
  attachmentPath,
  DAILY_UPLOAD_BYTES,
  hasRoomFor,
  MAX_ATTACHMENT_BYTES,
  PART_SUFFIX,
} from "../attachments.js";
import { db, isPgError, PG_UNIQUE_VIOLATION } from "../database.js";
import { authenticate } from "../middleware/auth.js";

// Encrypted files of messages: upload, copy (forwarding), download. The
// client encrypts a file before uploading it and chooses its id; the file
// is linked to a message when the message is sent (messages.ts).

const uploadRateLimit = {
  rateLimit: {
    max: 30,
    timeWindow: "1 minute",
  },
};

// Chats show many pictures at once.
const downloadRateLimit = {
  rateLimit: {
    max: 300,
    timeWindow: "1 minute",
  },
};

const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

// SQL: whether user $2 may read attachment $1: they uploaded it, it is in
// a message of a chat they are in (and have not cleared; in a group, sent
// since they joined), or it is the photo of a group they are in.
const CAN_READ = `
  SELECT a.size
  FROM attachments a
  LEFT JOIN messages m ON m.id = a.message_id
  WHERE a.id = $1
    AND (
      a.uploader_id = $2
      OR EXISTS (
        SELECT 1 FROM chat_members cm
        JOIN chats c ON c.id = cm.chat_id
        WHERE cm.chat_id = m.chat_id
          AND cm.user_id = $2
          AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at)
          AND (c.type <> 'group' OR m.created_at >= cm.joined_at)
      )
      OR EXISTS (
        SELECT 1 FROM chat_members cm
        WHERE cm.chat_id = a.chat_id
          AND cm.user_id = $2
      )
    )
`;

// Records an attachment of user $2, unless their uploads of the last day
// would exceed DAILY_UPLOAD_BYTES ($4) with it; returns no row then.
const INSERT_WITHIN_QUOTA = `
  INSERT INTO attachments (id, uploader_id, size)
  SELECT $1, $2, $3::int
  WHERE (
    SELECT COALESCE(SUM(size), 0) FROM attachments
    WHERE uploader_id = $2 AND created_at > NOW() - INTERVAL '1 day'
  ) + $3::int <= $4::bigint
  RETURNING id
`;

const ID_TAKEN = "An attachment with this id already exists";
const OVER_QUOTA = "You have uploaded too much today, try again tomorrow";
const TOO_LARGE = "The file is too large";

class TooLarge extends Error {}

// Passes at most `max` bytes through, counting them.
function byteLimit(max: number) {
  let total = 0;

  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      callback(total > max ? new TooLarge() : null, chunk);
    },
  });

  return { counter, size: () => total };
}

export default async function attachmentsRoutes(server: FastifyInstance) {
  // The body is streamed to disk by the route (after authentication), not
  // held in memory.
  server.addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload));

  // UPLOAD an encrypted file under the id the client chose.
  server.put<{ Params: { id: string }; Body: NodeJS.ReadableStream }>(
    "/api/attachments/:id",
    {
      preHandler: authenticate,
      config: uploadRateLimit,
      schema: { params: idParams },
    },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body;

      if (!body || typeof body.pipe !== "function") {
        return reply.status(415).send({ error: "Send the file as application/octet-stream" });
      }

      const declared = Number(request.headers["content-length"] ?? NaN);

      if (declared > MAX_ATTACHMENT_BYTES) {
        return reply.status(413).send({ error: TOO_LARGE });
      }

      if (!(await hasRoomFor(Number.isFinite(declared) ? declared : MAX_ATTACHMENT_BYTES))) {
        request.log.error("attachments: not enough disk space");
        return reply.status(507).send({ error: "The server is out of space, try later" });
      }

      // Answered before taking the file: clients upload again when an
      // answer got lost.
      if ((await db.query("SELECT 1 FROM attachments WHERE id = $1", [id])).rows.length > 0) {
        return reply.status(409).send({ error: ID_TAKEN });
      }

      const file = attachmentPath(id);
      // Unique per request: two uploads of one id do not share it.
      const part = `${file}.${crypto.randomBytes(8).toString("hex")}${PART_SUFFIX}`;
      const limit = byteLimit(MAX_ATTACHMENT_BYTES);

      try {
        // Written aside and renamed, so a file is never seen half written.
        await pipeline(body, limit.counter, createWriteStream(part, { mode: 0o600 }));
      } catch (error) {
        await unlink(part).catch(() => {});

        if (error instanceof TooLarge) {
          return reply.status(413).send({ error: TOO_LARGE });
        }

        throw error;
      }

      const size = limit.size();
      let saved;

      try {
        if (size === 0) {
          await unlink(part).catch(() => {});
          return reply.status(415).send({ error: "Send the file as application/octet-stream" });
        }

        saved = await db.query(INSERT_WITHIN_QUOTA, [id, request.user.id, size, DAILY_UPLOAD_BYTES]);
      } catch (error) {
        await unlink(part).catch(() => {});

        if (isPgError(error, PG_UNIQUE_VIOLATION)) {
          return reply.status(409).send({ error: ID_TAKEN });
        }

        throw error;
      }

      if (saved.rows.length === 0) {
        await unlink(part).catch(() => {});
        return reply.status(429).send({ error: OVER_QUOTA });
      }

      try {
        await rename(part, file);
      } catch (error) {
        await db.query("DELETE FROM attachments WHERE id = $1", [id]).catch(() => {});
        await unlink(part).catch(() => {});
        throw error;
      }

      return reply.status(201).send({ id, size });
    },
  );

  // COPY an attachment the user can read under a new id, to forward it
  // without uploading it again (its key stays the same).
  server.post<{ Params: { id: string }; Body: { id: string } }>(
    "/api/attachments/:id/copy",
    {
      preHandler: authenticate,
      config: uploadRateLimit,
      schema: {
        params: idParams,
        body: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const source = request.params.id;
      const target = request.body.id;

      const readable = await db.query(CAN_READ, [source, request.user.id]);
      const exists = await access(attachmentPath(source)).then(() => true, () => false);

      if (readable.rows.length === 0 || !exists) {
        return reply.status(404).send({ error: "Attachment not found" });
      }

      const size = readable.rows[0].size as number;

      if (!(await hasRoomFor(size))) {
        return reply.status(507).send({ error: "The server is out of space, try later" });
      }

      try {
        // Copies count towards the quota too: each is a file on disk.
        const saved = await db.query(INSERT_WITHIN_QUOTA, [target, request.user.id, size, DAILY_UPLOAD_BYTES]);

        if (saved.rows.length === 0) {
          return reply.status(429).send({ error: OVER_QUOTA });
        }
      } catch (error) {
        if (isPgError(error, PG_UNIQUE_VIOLATION)) {
          return reply.status(409).send({ error: ID_TAKEN });
        }

        throw error;
      }

      try {
        await copyFile(attachmentPath(source), attachmentPath(target) + PART_SUFFIX);
        await rename(attachmentPath(target) + PART_SUFFIX, attachmentPath(target));
      } catch (error) {
        await db.query("DELETE FROM attachments WHERE id = $1", [target]).catch(() => {});
        await unlink(attachmentPath(target) + PART_SUFFIX).catch(() => {});
        throw error;
      }

      return reply.status(201).send({ id: target, size });
    },
  );

  // DOWNLOAD an encrypted file.
  server.get<{ Params: { id: string } }>(
    "/api/attachments/:id",
    {
      preHandler: authenticate,
      config: downloadRateLimit,
      schema: { params: idParams },
    },
    async (request, reply) => {
      const { id } = request.params;
      const readable = await db.query(CAN_READ, [id, request.user.id]);

      const file = attachmentPath(id);

      if (readable.rows.length === 0 || !(await access(file).then(() => true, () => false))) {
        return reply.status(404).send({ error: "Attachment not found" });
      }

      return reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", String(readable.rows[0].size))
        // An id always has the same content; only for this user's cache.
        .header("Cache-Control", "private, max-age=31536000, immutable")
        .header("X-Content-Type-Options", "nosniff")
        .send(createReadStream(file));
    },
  );
}
