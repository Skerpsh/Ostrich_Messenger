import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import { DAILY_UPLOAD_BYTES, insertWithinQuota } from "../src/attachments.js";
import { db } from "../src/database.js";
import { checkSwitches } from "../src/disappear.js";
import { createSession } from "../src/routes/auth.js";
import serverViewRoutes from "../src/routes/server-view.js";
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

  await db.query("DELETE FROM chats WHERE id = ANY($1::uuid[])", [chats]);
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
