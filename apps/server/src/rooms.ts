import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { db, withTransaction } from "./database.js";
import { MAX_GROUP_MEMBERS } from "./groups.js";
import { sendToChatMembers, sendToUserSockets } from "./realtime.js";

// Anonymous rooms (migrations/014_rooms.sql): public chats anyone may
// enter under a name of their choice and leave. Inside, the user acts as
// their persona (a user row of its own): the auth middleware and the
// websocket swap it in for the real account on a room's routes, so the
// rest of the code treats a room like a group whose member is the persona.

export const ROOM_CAPACITY = MAX_GROUP_MEMBERS;
// Never fewer rooms; a new one opens when more than half of all places
// are taken. Empty rooms stay.
export const MIN_ROOMS = 3;
const GROW_AT = 0.5;

// Who has not opened Ostrich for this long is taken out of their rooms,
// so that their places come free.
export const INACTIVE_DAYS = 30;

// Reports (see the migration): by this many people.
export const REPORTS_TO_DELETE = 3;
export const REPORTS_TO_MUTE = 3;
const REPORT_WINDOW_MS = 10 * 60 * 1000;
const FIRST_MUTE_MS = 30 * 60 * 1000;
const MAX_MUTE_MS = 30 * 24 * 60 * 60 * 1000;

// Messages a persona may send in a row.
export const SEND_LIMIT = 10;
export const SEND_WINDOW_MS = 10_000;

// All room changes (entering, leaving, opening a new one) one at a time.
const ROOMS_LOCK = 7_301_885;

export const roomName = (number: number) => `room_${String(number).padStart(2, "0")}`;

const ANIMALS = [
  "parrot", "cat", "fox", "owl", "otter", "panda", "koala", "lynx", "wolf", "bear",
  "hedgehog", "raccoon", "badger", "beaver", "falcon", "heron", "penguin", "seal",
  "walrus", "moose", "bison", "camel", "llama", "gecko", "iguana", "turtle", "frog",
  "newt", "squid", "octopus", "crab", "shrimp", "dolphin", "orca", "shark", "eel",
  "sparrow", "robin", "crow", "raven", "magpie", "finch", "swan", "goose", "duck",
  "rabbit", "hare", "mouse", "hamster", "ferret", "mole", "bat", "sloth", "lemur",
  "yak", "zebra", "giraffe", "rhino", "hippo", "tiger", "lion", "leopard", "jaguar",
];

// "parrot_34": an animal and a number, a valid username.
export function randomNickname() {
  return `${ANIMALS[crypto.randomInt(ANIMALS.length)]}_${crypto.randomInt(1, 10_000)}`;
}

async function createRoom(client: PoolClient) {
  await client.query(
    `
    INSERT INTO chats (type, room_number, room_key)
    SELECT 'room', COALESCE(MAX(room_number), 0) + 1, $1
    FROM chats WHERE type = 'room'
    `,
    [crypto.randomBytes(32).toString("base64")],
  );
}

// Opens rooms until there are MIN_ROOMS and at most half of the places
// are taken (inside the caller's transaction, holding ROOMS_LOCK).
async function openRooms(client: PoolClient) {
  for (;;) {
    const { rows } = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM chats WHERE type = 'room') AS rooms,
        (SELECT COUNT(*)::int FROM chat_members JOIN chats ON chats.id = chat_members.chat_id AND chats.type = 'room') AS people
    `);
    const { rooms, people } = rows[0];

    if (rooms >= MIN_ROOMS && people <= rooms * ROOM_CAPACITY * GROW_AT) {
      return;
    }

    await createRoom(client);
  }
}

// At startup: the first rooms.
export function ensureRooms() {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [ROOMS_LOCK]);
    await openRooms(client);
  });
}

// The rooms, with how many are in each and whether the user is.
export async function listRooms(userId: string) {
  const result = await db.query(
    `
    SELECT
      chats.id,
      chats.room_number,
      (SELECT COUNT(*)::int FROM chat_members cm WHERE cm.chat_id = chats.id) AS member_count,
      EXISTS (
        SELECT 1 FROM chat_members cm
        JOIN users persona ON persona.id = cm.user_id
        WHERE cm.chat_id = chats.id AND persona.persona_of = $1
      ) AS joined
    FROM chats
    WHERE chats.type = 'room'
    ORDER BY chats.room_number
    `,
    [userId],
  );

  return result.rows.map((row) => ({ ...row, name: roomName(row.room_number), capacity: ROOM_CAPACITY }));
}

// How the user acts in a chat: a room's persona (null if not in the room),
// or themselves in any other chat.
export async function chatActor(chatId: string, userId: string) {
  const result = await db.query(
    `
    SELECT persona.id, persona.username
    FROM chats
    LEFT JOIN chat_members cm ON cm.chat_id = chats.id
      AND cm.user_id IN (SELECT id FROM users WHERE persona_of = $2)
    LEFT JOIN users persona ON persona.id = cm.user_id
    WHERE chats.id = $1 AND chats.type = 'room'
    `,
    [chatId, userId],
  );

  const row = result.rows[0];

  return row
    ? { room: true as const, persona: row.id ? (row as { id: string; username: string }) : null }
    : { room: false as const, persona: null };
}

export type JoinError = "not_found" | "already_in" | "full" | "name_taken";

export async function joinRoom(userId: string, roomId: string, nickname: string) {
  return withTransaction(async (client): Promise<{ error: JoinError } | { personaId: string }> => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [ROOMS_LOCK]);

    const { rows } = await client.query(
      `
      SELECT
        (SELECT COUNT(*)::int FROM chat_members WHERE chat_id = chats.id) AS people,
        EXISTS (
          SELECT 1 FROM chat_members cm
          JOIN users persona ON persona.id = cm.user_id
          WHERE cm.chat_id = chats.id AND persona.persona_of = $2
        ) AS joined,
        EXISTS (
          SELECT 1 FROM chat_members cm
          JOIN users persona ON persona.id = cm.user_id
          WHERE cm.chat_id = chats.id AND LOWER(persona.username) = LOWER($3)
        ) AS taken
      FROM chats
      WHERE id = $1 AND type = 'room'
      `,
      [roomId, userId, nickname],
    );

    const room = rows[0];

    if (!room) return { error: "not_found" };
    if (room.joined) return { error: "already_in" };
    if (room.people >= ROOM_CAPACITY) return { error: "full" };
    if (room.taken) return { error: "name_taken" };

    // No password: a persona never signs in (and is left out of every
    // lookup by username); nobody sees it online.
    const persona = await client.query(
      `
      INSERT INTO users (username, password_hash, persona_of, show_presence)
      VALUES ($1, '', $2, FALSE)
      RETURNING id
      `,
      [nickname, userId],
    );
    const personaId = persona.rows[0].id as string;

    await client.query("INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2)", [roomId, personaId]);
    await client.query("UPDATE users SET last_room_nickname = $2 WHERE id = $1", [userId, nickname]);
    await openRooms(client);

    return { personaId };
  });
}

// Takes the user's persona out of the room; its messages stay. Returns
// whether they were in it.
export async function leaveRoom(userId: string, roomId: string) {
  const result = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [ROOMS_LOCK]);

    return client.query(
      `
      DELETE FROM chat_members
      USING users persona
      WHERE chat_members.chat_id = $1
        AND persona.id = chat_members.user_id
        AND persona.persona_of = $2
      `,
      [roomId, userId],
    );
  });

  if (result.rowCount === 0) {
    return false;
  }

  sendToUserSockets(userId, { type: "chat_deleted", chatId: roomId });
  await sendToChatMembers(roomId, { type: "chats_changed" });

  return true;
}

// Takes out of their rooms the users who have not opened Ostrich for
// INACTIVE_DAYS (last seen is written when the last device disconnects).
export async function leaveInactive() {
  const result = await db.query(
    `
    DELETE FROM chat_members
    USING users persona, users account
    WHERE persona.id = chat_members.user_id
      AND account.id = persona.persona_of
      AND COALESCE(account.last_seen_at, account.created_at) < NOW() - make_interval(days => $1)
    RETURNING chat_members.chat_id, account.id AS user_id
    `,
    [INACTIVE_DAYS],
  );

  for (const row of result.rows) {
    sendToUserSockets(row.user_id, { type: "chat_deleted", chatId: row.chat_id });
  }
}

// Why a persona may not send now: its account is muted (until when), or
// it sends too fast; null if it may (and for anyone not a persona).
export async function roomSendBlock(chatId: string, senderId: string) {
  const result = await db.query(
    `
    SELECT
      CASE WHEN account.room_muted_until > NOW() THEN account.room_muted_until END AS muted_until,
      (
        SELECT COUNT(*)::int FROM messages
        WHERE chat_id = $1 AND sender_id = $2
          AND created_at > NOW() - make_interval(secs => $3)
      ) AS recent
    FROM users persona
    JOIN users account ON account.id = persona.persona_of
    WHERE persona.id = $2
    `,
    [chatId, senderId, SEND_WINDOW_MS / 1000],
  );

  const row = result.rows[0];

  if (!row) return null;
  if (row.muted_until) return { error: "muted" as const, until: row.muted_until as Date };
  if (row.recent >= SEND_LIMIT) return { error: "too_fast" as const };

  return null;
}

// How long the n-th mute (from 1) lasts.
export const muteLength = (n: number) => Math.min(FIRST_MUTE_MS * 2 ** (n - 1), MAX_MUTE_MS);

export type ReportError = "not_found" | "own_message";

// A report of a room's message by a user in that room. Returns whether
// the message was deleted for it.
export async function reportMessage(userId: string, roomId: string, messageId: string) {
  return withTransaction(async (client): Promise<{ error: ReportError } | { deleted: boolean }> => {
    const target = await client.query(
      `
      SELECT author.persona_of AS author_id
      FROM messages
      JOIN users author ON author.id = messages.sender_id
      WHERE messages.id = $1
        AND messages.chat_id = $2
        AND messages.kind = 'text'
        AND EXISTS (
          SELECT 1 FROM chat_members cm
          JOIN users persona ON persona.id = cm.user_id
          WHERE cm.chat_id = $2 AND persona.persona_of = $3
        )
      `,
      [messageId, roomId, userId],
    );

    const authorId = target.rows[0]?.author_id as string | undefined;

    if (!authorId) return { error: "not_found" };
    if (authorId === userId) return { error: "own_message" };

    await client.query(
      `
      INSERT INTO room_reports (message_id, reporter_id, author_id)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
      `,
      [messageId, userId, authorId],
    );

    // Lock the author while counting, so two reports at once mute once.
    const author = await client.query(
      "SELECT room_muted_until, room_mutes FROM users WHERE id = $1 FOR UPDATE",
      [authorId],
    );
    const { room_muted_until: mutedUntil, room_mutes: mutes } = author.rows[0];

    // Reports from before the last mute ended were paid for by it.
    const counts = await client.query(
      `
      SELECT
        (SELECT COUNT(*)::int FROM room_reports WHERE message_id = $1) AS on_message,
        (
          SELECT COUNT(DISTINCT reporter_id)::int FROM room_reports
          WHERE author_id = $2
            AND created_at > NOW() - make_interval(secs => $3)
            AND created_at > COALESCE($4::timestamptz, '-infinity')
        ) AS on_author
      `,
      [messageId, authorId, REPORT_WINDOW_MS / 1000, mutedUntil],
    );
    const { on_message: onMessage, on_author: onAuthor } = counts.rows[0];

    if (onAuthor >= REPORTS_TO_MUTE && !(mutedUntil && mutedUntil > new Date())) {
      await client.query(
        `
        UPDATE users
        SET room_mutes = room_mutes + 1,
            room_muted_until = NOW() + make_interval(secs => $2)
        WHERE id = $1
        `,
        [authorId, muteLength(mutes + 1) / 1000],
      );
    }

    if (onMessage >= REPORTS_TO_DELETE) {
      await client.query("DELETE FROM messages WHERE id = $1", [messageId]);
      return { deleted: true };
    }

    return { deleted: false };
  });
}
