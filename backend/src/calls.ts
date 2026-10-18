import crypto from "node:crypto";
import { db } from "./database.js";
import { isBlockedInChat } from "./messages.js";
import { metrics } from "./metrics.js";
import { connectionCount, sendToSocket, sendToUsers } from "./realtime.js";
import { sharedState } from "./shared-state.js";

// Calls: one-to-one audio calls in direct chats, peer to peer (WebRTC).
// The server passes the devices' signals between them (the offer, the
// answer, network candidates: frontend lib/calls.ts encrypts them end to
// end, so the server cannot swap the keys of the call's encryption) and
// keeps who is calling whom while a call lasts, in the shared state:
//   call:<id>         the call (Call, JSON)
//   call-user:<user>  the call a user is in: one at a time, others get "busy"
//   call-answer:<id>  the socket that answered, claimed by the first device
// Nothing about calls reaches the database; the chat's call entries
// ("Missed call", "Call, 4:12") are messages the caller's app sends.
//
// A call rings on every open socket of the callee; once answered, signals
// go only between the caller's socket and the socket that answered. A
// socket that reconnects (new id) takes its place again with call_resume.

export type Call = {
  id: string;
  chatId: string;
  callerId: string;
  calleeId: string;
  // Socket ids, and the sessions they belong to (a reconnected socket of
  // the same session may take its side's place again).
  callerSocket: string;
  callerSession: string;
  calleeSocket: string | null;
  calleeSession: string | null;
  answeredAt: number | null;
};

// Unanswered calls end after this (the caller's app hangs up after 45s).
const RING_MS = 60_000;
// Answered calls last while both sides send keepalives (every 15s).
const LIVE_MS = 45_000;
// A socket in a call that closes has this long to reconnect and resume.
const RESUME_MS = 20_000;

// What clients send: "c1:" + base64 of the encrypted signal.
const SIGNAL_RE = /^c1:[A-Za-z0-9+/]+={0,2}$/;
export const MAX_SIGNAL_LENGTH = 40_000;

export function isCallSignal(data: unknown): data is string {
  return typeof data === "string" && data.length <= MAX_SIGNAL_LENGTH && SIGNAL_RE.test(data);
}

// Why a call ended, as both sides are told.
export type EndReason =
  | "declined"
  | "cancelled"
  | "hangup"
  | "disconnected"
  | "timeout"
  | "answered_elsewhere"
  | "blocked";

export type CallError = "not_member" | "not_direct" | "blocked" | "busy" | "in_call" | "unavailable" | "duplicate_id";

export const CALL_ERRORS: Record<CallError, string> = {
  not_member: "You are not a member of this chat",
  not_direct: "Calls are only in direct chats",
  blocked: "You can't call this user",
  busy: "They are in another call",
  in_call: "You are already in a call",
  unavailable: "They are not online",
  duplicate_id: "A call with this id already exists",
};

// The socket a client message came from.
export type CallSide = {
  userId: string;
  tokenHash: string;
  socketId: string;
};

const callKey = (id: string) => `call:${id}`;
const userKey = (userId: string) => `call-user:${userId}`;
const answerKey = (id: string) => `call-answer:${id}`;

async function loadCall(id: string): Promise<Call | null> {
  const value = await sharedState().getValue(callKey(id));

  try {
    return value ? (JSON.parse(value) as Call) : null;
  } catch {
    return null;
  }
}

function saveCall(call: Call, ms: number) {
  return sharedState().setValue(callKey(call.id), JSON.stringify(call), ms);
}

const allKeys = (call: Call) => [callKey(call.id), answerKey(call.id), userKey(call.callerId), userKey(call.calleeId)];

// Ends the call and tells the sides why: the caller's socket, and the
// callee's answering socket or (unanswered) all of the callee's sockets.
// A user's "in a call" mark goes only if it is still this call's.
async function endCall(call: Call, reason: EndReason, notify: { caller?: boolean; callee?: boolean } = { caller: true, callee: true }) {
  const state = sharedState();
  const marks = await Promise.all([state.getValue(userKey(call.callerId)), state.getValue(userKey(call.calleeId))]);

  await state.deleteValues([
    callKey(call.id),
    answerKey(call.id),
    ...(marks[0] === call.id ? [userKey(call.callerId)] : []),
    ...(marks[1] === call.id ? [userKey(call.calleeId)] : []),
  ]);

  const event = { type: "call_ended", callId: call.id, reason };

  if (notify.caller) {
    await sendToSocket(call.callerSocket, event);
  }

  if (notify.callee) {
    if (call.calleeSocket) {
      await sendToSocket(call.calleeSocket, event);
    } else {
      await sendToUsers([call.calleeId], event);
    }
  }
}

// Unanswered calls whose time is up, ended by the process that started
// them (the keys also expire on their own if it dies).
const ringTimers = new Map<string, NodeJS.Timeout>();

export async function startCall(
  side: CallSide,
  chatId: string,
  callId: string,
  data: string,
): Promise<{ ok: true } | { error: CallError }> {
  const result = await db.query(
    `
    SELECT chats.type, other.user_id AS peer_id
    FROM chats
    JOIN chat_members me ON me.chat_id = chats.id AND me.user_id = $2
    LEFT JOIN chat_members other ON other.chat_id = chats.id AND other.user_id <> $2
    WHERE chats.id = $1
    `,
    [chatId, side.userId],
  );

  const row = result.rows[0];

  if (!row) {
    return { error: "not_member" };
  }

  if (row.type !== "direct" || !row.peer_id) {
    return { error: "not_direct" };
  }

  if (await isBlockedInChat(chatId, side.userId)) {
    return { error: "blocked" };
  }

  const calleeId: string = row.peer_id;

  if ((await connectionCount(calleeId)) === 0) {
    return { error: "unavailable" };
  }

  const state = sharedState();

  if (!(await state.claimValue(userKey(side.userId), callId, RING_MS))) {
    return { error: "in_call" };
  }

  if (!(await state.claimValue(userKey(calleeId), callId, RING_MS))) {
    await state.deleteValues([userKey(side.userId)]);
    return { error: "busy" };
  }

  const call: Call = {
    id: callId,
    chatId,
    callerId: side.userId,
    calleeId,
    callerSocket: side.socketId,
    callerSession: side.tokenHash,
    calleeSocket: null,
    calleeSession: null,
    answeredAt: null,
  };

  if (!(await state.claimValue(callKey(callId), JSON.stringify(call), RING_MS))) {
    await state.deleteValues([userKey(side.userId), userKey(calleeId)]);
    return { error: "duplicate_id" };
  }

  metrics.callsStarted++;

  ringTimers.set(
    callId,
    setTimeout(() => {
      ringTimers.delete(callId);

      (async () => {
        const current = await loadCall(callId);

        if (current && current.answeredAt === null) {
          await endCall(current, "timeout");
        }
      })().catch(() => {});
    }, RING_MS),
  );

  await sendToUsers([calleeId], {
    type: "call_incoming",
    call: { id: callId, chatId, callerId: side.userId },
    data,
  });

  return { ok: true };
}

function stopRinging(callId: string) {
  clearTimeout(ringTimers.get(callId));
  ringTimers.delete(callId);
}

// The callee's device takes the call; false if it cannot (another device
// was first, or the call is over).
export async function answerCall(side: CallSide, callId: string, data: string) {
  const call = await loadCall(callId);

  if (!call || call.calleeId !== side.userId || call.answeredAt !== null) {
    return false;
  }

  const state = sharedState();

  if (!(await state.claimValue(answerKey(callId), side.socketId, LIVE_MS))) {
    return false;
  }

  stopRinging(callId);
  metrics.callsAnswered++;

  const answered: Call = {
    ...call,
    calleeSocket: side.socketId,
    calleeSession: side.tokenHash,
    answeredAt: Date.now(),
  };

  await saveCall(answered, LIVE_MS);
  await state.extendValues([userKey(call.callerId), userKey(call.calleeId)], LIVE_MS);

  await sendToSocket(call.callerSocket, { type: "call_answered", callId, data });
  // The callee's other devices stop ringing (the one that answered
  // ignores it).
  await sendToUsers([call.calleeId], { type: "call_ended", callId, reason: "answered_elsewhere" });

  return true;
}

// Which side of the call the socket is, if it is one.
function sideOf(call: Call, side: CallSide): "caller" | "callee" | null {
  if (call.callerSocket === side.socketId) {
    return "caller";
  }

  return call.calleeSocket === side.socketId ? "callee" : null;
}

// The callee refuses the call (from any of their devices, while it rings).
export async function declineCall(side: CallSide, callId: string) {
  const call = await loadCall(callId);

  if (!call || call.calleeId !== side.userId || call.answeredAt !== null) {
    return;
  }

  stopRinging(callId);
  await endCall(call, "declined");
}

// Either side ends the call; the caller can also stop it while it rings.
export async function hangUp(side: CallSide, callId: string) {
  const call = await loadCall(callId);
  const which = call && sideOf(call, side);

  if (!call || !which) {
    return;
  }

  stopRinging(callId);

  if (call.answeredAt === null) {
    await endCall(call, "cancelled", { callee: true });
    return;
  }

  await endCall(call, "hangup", which === "caller" ? { callee: true } : { caller: true });
}

// A signal for the other side of an answered call.
export async function relaySignal(side: CallSide, callId: string, data: string) {
  const call = await loadCall(callId);
  const which = call && sideOf(call, side);

  if (!call || !which || call.answeredAt === null) {
    return false;
  }

  const to = which === "caller" ? call.calleeSocket : call.callerSocket;

  if (to) {
    await sendToSocket(to, { type: "call_signal", callId, data });
  }

  return true;
}

// Both sides of an answered call send these: the call is kept while they
// come. False if the call is over.
export async function keepCallAlive(side: CallSide, callId: string) {
  const call = await loadCall(callId);

  if (!call || !sideOf(call, side) || call.answeredAt === null) {
    return false;
  }

  await sharedState().extendValues(allKeys(call), LIVE_MS);
  return true;
}

// A reconnected socket of the same session takes its side's place again.
export async function resumeCall(side: CallSide, callId: string) {
  const call = await loadCall(callId);

  if (!call) {
    return false;
  }

  let resumed: Call;

  if (call.callerId === side.userId && call.callerSession === side.tokenHash) {
    resumed = { ...call, callerSocket: side.socketId };
  } else if (call.calleeId === side.userId && call.calleeSession === side.tokenHash) {
    resumed = { ...call, calleeSocket: side.socketId };
  } else {
    return false;
  }

  await saveCall(resumed, call.answeredAt === null ? RING_MS : LIVE_MS);
  return true;
}

// A socket closed: if it was in a call, the call ends unless it comes back
// (call_resume from its reconnected socket) in time.
export async function socketClosed(side: CallSide) {
  const callId = await sharedState().getValue(userKey(side.userId));
  const call = callId ? await loadCall(callId) : null;

  if (!call || !sideOf(call, side)) {
    return;
  }

  setTimeout(() => {
    (async () => {
      const current = await loadCall(call.id);
      const which = current && sideOf(current, side);

      if (!current || !which) {
        return;
      }

      stopRinging(current.id);

      if (current.answeredAt === null) {
        await endCall(current, "cancelled", { callee: true });
      } else {
        await endCall(current, "disconnected", which === "caller" ? { callee: true } : { caller: true });
      }
    })().catch(() => {});
  }, RESUME_MS).unref();
}

// One of the two blocked the other: a call between them ends.
export async function endCallsBetween(userA: string, userB: string) {
  const callId = await sharedState().getValue(userKey(userA));
  const call = callId ? await loadCall(callId) : null;

  if (call && (call.callerId === userB || call.calleeId === userB)) {
    stopRinging(call.id);
    await endCall(call, "blocked");
  }
}

// --- TURN ---

// The TURN server (coturn) relays calls between devices that cannot reach
// each other directly. Its logins are made here and checked by coturn
// with the same secret (its "use-auth-secret" option): username
// "<expiry>:<user id>", password base64(HMAC-SHA1(secret, username)).
// TURN_URLS: comma separated, e.g. "turn:turn.example.com:3478?transport=udp,
// turn:turn.example.com:3478?transport=tcp"; STUN_URLS likewise (coturn
// answers STUN on the same port). Without them, devices connect only
// directly (enough on one network, or when one side has a public address).
const TURN_URLS = list(process.env.TURN_URLS);
const STUN_URLS = list(process.env.STUN_URLS);
const TURN_SECRET = process.env.TURN_SECRET || undefined;
const TURN_TTL_S = 6 * 60 * 60;

function list(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export type IceServer = { urls: string[]; username?: string; credential?: string };

export function iceServers(userId: string, now = Date.now()): { iceServers: IceServer[]; ttl: number } {
  const servers: IceServer[] = [];

  if (STUN_URLS.length > 0) {
    servers.push({ urls: STUN_URLS });
  }

  if (TURN_URLS.length > 0 && TURN_SECRET) {
    servers.push({ urls: TURN_URLS, ...turnLogin(TURN_SECRET, userId, now) });
  }

  return { iceServers: servers, ttl: TURN_TTL_S };
}

export function turnLogin(secret: string, userId: string, now: number) {
  const username = `${Math.floor(now / 1000) + TURN_TTL_S}:${userId}`;
  const credential = crypto.createHmac("sha1", secret).update(username).digest("base64");

  return { username, credential };
}
