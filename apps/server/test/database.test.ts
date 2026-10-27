import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import { DAILY_UPLOAD_BYTES, insertWithinQuota } from "../src/attachments.js";
import { db } from "../src/database.js";
import { checkSwitches } from "../src/disappear.js";
import { createMessage } from "../src/messages.js";
import { createSession } from "../src/routes/auth.js";
import chatsRoutes from "../src/routes/chats.js";
import messagesRoutes from "../src/routes/messages.js";
import serverViewRoutes from "../src/routes/server-view.js";
import { ensureRooms, joinRoom, leaveRoom, listRooms, reportMessage, ROOM_CAPACITY, SEND_LIMIT } from "../src/rooms.js";
import { MemoryState, useSharedState } from "../src/shared-state.js";

// The SQL itself, against a real PostgreSQL with the migrations applied
// (npm run db:migrate): only with DB_TEST=1, as in CI. Its rows are
// removed afterwards.
const options = { skip: process.env.DB_TEST !== "1" && "DB_TEST=1 not set" };

const users: string[] = [];
const chats: string[] = [];
const HOUR = 60 * 60 * 1000;

async function user() {
  const name = `t${crypto.randomBytes(6).toString("hex")}`;
  const result = await db.query("INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id", [name]);
  users.push(result.rows[0].id);
  return result.rows[0].id as string;
}

async function directChat(...members: string[]) {
  const result = await db.query("INSERT INTO chats (type) VALUES ('direct') RETURNING id");
  const chatId = result.rows[0].id as string;
  chats.push(chatId);

  for (const member of members) {
    await db.query("INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2)", [chatId, member]);
  }

  return chatId;
}

// A switch of `userId` that went off `ago` ms before, with one message
// left to send in `chatId`.
async function wentOff(userId: string, chatId: string, ago: number) {
  const id = crypto.randomUUID();
  await db.query("INSERT INTO disappear_switches (user_id, days, triggered_at) VALUES ($1, 2, $2)", [
    userId,
    new Date(Date.now() - ago),
  ]);
  await db.query("INSERT INTO disappear_messages (id, user_id, chat_id, content) VALUES ($1, $2, $3, 'e2:AAAA')", [
    id,
    userId,
    chatId,
  ]);
  return id;
}

const sent = async (id: string) => (await db.query("SELECT 1 FROM messages WHERE id = $1", [id])).rows.length;
const left = async (id: string) => (await db.query("SELECT 1 FROM disappear_messages WHERE id = $1", [id])).rows.length;

before(() => {
  useSharedState(new MemoryState());
});

after(async () => {
  if (options.skip) {
    return;
  }

  await db.query("DELETE FROM chats WHERE id = ANY($1::uuid[]) OR type = 'room'", [chats]);
  await db.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  await db.end();
});

test("the server's view of a message", options, async () => {
  const ann = await user();
  const bob = await user();
  const chatId = await directChat(ann, bob);
  const messageId = crypto.randomUUID();
  await db.query("INSERT INTO messages (id, chat_id, sender_id, content) VALUES ($1, $2, $3, 'e2:AAAA')", [
    messageId,
    chatId,
    ann,
  ]);

  const server = Fastify();
  await server.register(serverViewRoutes);
  const token = await createSession(bob, "test");

  const message = await server.inject({
    url: `/api/chats/${chatId}/messages/${messageId}/server-view`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(message.statusCode, 200, message.body);
  assert.equal(message.json().message.content, "e2:AAAA");

  const chat = await server.inject({
    url: `/api/chats/${chatId}/server-view`,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(chat.statusCode, 200, chat.body);
  assert.equal(chat.json().stats.messages, 1);

  await server.close();
});

test("\"If I disappear\": what was left after going off is sent while the user stays away", options, async () => {
  const away = await user();
  const back = await user();
  const friend = await user();

  const waiting = await wentOff(away, await directChat(away, friend), HOUR);
  // Logged in since it went off: what is left stays for them to see.
  const kept = await wentOff(back, await directChat(back, friend), HOUR);
  await createSession(back, "test");

  await checkSwitches();

  assert.equal(await sent(waiting), 1);
  assert.equal(await left(waiting), 0);
  assert.equal(await sent(kept), 0);
  assert.equal(await left(kept), 1);
});

test("\"If I disappear\": a message sent before the try was cut off is not sent twice", options, async () => {
  const away = await user();
  const chatId = await directChat(away, await user());
  const id = await wentOff(away, chatId, HOUR);
  await db.query("INSERT INTO messages (id, chat_id, sender_id, content) VALUES ($1, $2, $3, 'e2:AAAA')", [id, chatId, away]);

  await checkSwitches();

  assert.equal(await sent(id), 1);
  assert.equal(await left(id), 0);
});

test("parallel uploads stay within the daily quota", options, async () => {
  const uploader = await user();
  const size = Math.floor(DAILY_UPLOAD_BYTES * 0.4);

  const saved = await Promise.all(
    Array.from({ length: 5 }, () => insertWithinQuota(crypto.randomUUID(), uploader, size)),
  );

  assert.equal(saved.filter(Boolean).length, 2);
});

// A room message of `personaId`, as clients send it (room key, epoch 0).
const roomMessage = (roomId: string, personaId: string) =>
  createMessage(roomId, personaId, "e3:0:AAAA", null, crypto.randomUUID());

async function enter(roomId: string, nickname = `n${crypto.randomBytes(5).toString("hex")}`) {
  const account = await user();
  const result = await joinRoom(account, roomId, nickname);
  assert.ok("personaId" in result, JSON.stringify(result));
  return { account, persona: result.personaId };
}

test("rooms: inside, the user is only their persona", options, async () => {
  await ensureRooms();
  const [room] = await listRooms(await user());
  const ann = await enter(room.id, "Parrot_34");

  assert.deepEqual(await joinRoom(await user(), room.id, "parrot_34"), { error: "name_taken" });
  assert.deepEqual(await joinRoom(ann.account, room.id, "owl_1"), { error: "already_in" });

  const bob = await enter(room.id);
  const server = Fastify();
  await server.register(chatsRoutes);
  await server.register(messagesRoutes);
  const as = async (account: string) => ({ authorization: `Bearer ${await createSession(account, "test")}` });

  const sent = await server.inject({
    method: "POST",
    url: `/api/chats/${room.id}/messages`,
    headers: await as(ann.account),
    payload: { id: crypto.randomUUID(), content: "e3:0:AAAA" },
  });
  assert.equal(sent.statusCode, 201, sent.body);
  assert.equal(sent.json().message.sender_id, ann.persona);
  assert.equal(sent.json().message.sender_username, "Parrot_34");

  const list = await server.inject({ url: "/api/chats", headers: await as(bob.account) });
  const listed = list.json().chats.find((chat: { id: string }) => chat.id === room.id);
  assert.equal(listed.self_id, bob.persona);
  assert.ok(listed.room_key);
  assert.equal(listed.last_message.sender_id, ann.persona);
  assert.equal(listed.unread_count, 1);
  assert.ok(!list.body.includes(ann.account), "the real account never shows");

  // Nobody deletes the room, and outsiders do not read it.
  const deleted = await server.inject({ method: "DELETE", url: `/api/chats/${room.id}`, headers: await as(ann.account) });
  assert.equal(deleted.statusCode, 403);
  const outsider = await server.inject({ url: `/api/chats/${room.id}/messages`, headers: await as(await user()) });
  assert.equal(outsider.statusCode, 403);

  // Leaving keeps what was written.
  assert.equal(await leaveRoom(ann.account, room.id), true);
  const history = await server.inject({ url: `/api/chats/${room.id}/messages`, headers: await as(bob.account) });
  assert.equal(history.json().messages.length, 1);
  await server.close();
});

test("rooms: reports delete a message and mute its author", options, async () => {
  await ensureRooms();
  const [room] = await listRooms(await user());
  const author = await enter(room.id);
  const sent = await roomMessage(room.id, author.persona);
  assert.ok("message" in sent);

  assert.deepEqual(await reportMessage(author.account, room.id, sent.message.id), { error: "own_message" });

  for (let i = 0; i < 3; i++) {
    const reporter = await enter(room.id);
    assert.deepEqual(await reportMessage(reporter.account, room.id, sent.message.id), { deleted: i === 2 });
  }

  const muted = await roomMessage(room.id, author.persona);
  assert.ok("error" in muted && muted.error === "room_muted");
});

test("rooms: sending too fast", options, async () => {
  await ensureRooms();
  const [room] = await listRooms(await user());
  const { persona } = await enter(room.id);

  for (let i = 0; i < SEND_LIMIT; i++) {
    assert.ok("message" in (await roomMessage(room.id, persona)));
  }

  assert.deepEqual(await roomMessage(room.id, persona), { error: "room_too_fast" });
});

test("rooms: a new one opens when more than half of the places are taken", options, async () => {
  await ensureRooms();
  const before = await listRooms(await user());
  const free = before.length * ROOM_CAPACITY / 2 - before.reduce((sum, room) => sum + room.member_count, 0);

  for (let i = 0; i <= free; i++) {
    await enter(before[i % before.length].id);
  }

  const after = await listRooms(await user());
  assert.equal(after.length, before.length + 1);
  assert.equal(after.at(-1)!.name, `room_${String(before.length + 1).padStart(2, "0")}`);
});

test("rooms: a persona sends the files its account uploaded", options, async () => {
  await ensureRooms();
  const [room] = await listRooms(await user());
  const { account, persona } = await enter(room.id);
  const file = crypto.randomUUID();
  assert.ok(await insertWithinQuota(file, account, 100));

  const sent = await createMessage(room.id, persona, "e3:0:AAAA", null, crypto.randomUUID(), [file]);
  assert.ok("message" in sent, JSON.stringify(sent));
});
