import assert from "node:assert/strict";
import crypto from "node:crypto";
import { beforeEach, test } from "node:test";
import {
  answerCall,
  declineCall,
  hangUp,
  isCallSignal,
  keepCallAlive,
  MAX_SIGNAL_LENGTH,
  relaySignal,
  resumeCall,
  turnLogin,
  type Call,
  type CallSide,
} from "../src/calls.js";
import { MemoryState, useSharedState, type ClusterEvent } from "../src/shared-state.js";

// The call's flow after it has started (starting needs the database):
// who may answer, where signals go, how it ends.

const caller: CallSide = { userId: "ann", tokenHash: "ann-session", socketId: "ann-socket" };
const phone: CallSide = { userId: "bob", tokenHash: "bob-phone", socketId: "bob-phone-socket" };
const laptop: CallSide = { userId: "bob", tokenHash: "bob-laptop", socketId: "bob-laptop-socket" };

let state: MemoryState;
let events: ClusterEvent[];

const ringing = (): Call => ({
  id: "call-1",
  chatId: "chat-1",
  callerId: "ann",
  calleeId: "bob",
  callerSocket: caller.socketId,
  callerSession: caller.tokenHash,
  calleeSocket: null,
  calleeSession: null,
  answeredAt: null,
});

beforeEach(async () => {
  state = new MemoryState();
  useSharedState(state);
  events = [];
  state.subscribe((event) => events.push(event));

  await state.setValue("call:call-1", JSON.stringify(ringing()), 60_000);
  await state.setValue("call-user:ann", "call-1", 60_000);
  await state.setValue("call-user:bob", "call-1", 60_000);
});

const sent = () =>
  events.map((event) =>
    event.type === "deliver_socket"
      ? { to: event.socketId, ...JSON.parse(event.data) }
      : event.type === "deliver"
        ? { to: event.userIds.join(","), ...JSON.parse(event.data) }
        : event,
  );

test("signals are c1: base64 of a bounded size", () => {
  assert.ok(isCallSignal("c1:AAAA"));
  assert.ok(!isCallSignal("e2:AAAA"));
  assert.ok(!isCallSignal("c1:AA AA"));
  assert.ok(!isCallSignal("c1:" + "A".repeat(MAX_SIGNAL_LENGTH)));
  assert.ok(!isCallSignal(42));
});

test("the first device to answer gets the call", async () => {
  assert.equal(await answerCall(laptop, "call-1", "c1:ANSWER"), true);
  assert.equal(await answerCall(phone, "call-1", "c1:LATE"), false);
  // Not the callee.
  assert.equal(await answerCall(caller, "call-1", "c1:X"), false);

  assert.deepEqual(sent(), [
    { to: caller.socketId, type: "call_answered", callId: "call-1", data: "c1:ANSWER" },
    { to: "bob", type: "call_ended", callId: "call-1", reason: "answered_elsewhere" },
  ]);
});

test("signals go only between the two sockets of the call", async () => {
  await answerCall(phone, "call-1", "c1:ANSWER");
  events = [];

  assert.equal(await relaySignal(caller, "call-1", "c1:FROMANN"), true);
  assert.equal(await relaySignal(phone, "call-1", "c1:FROMBOB"), true);
  // Bob's other device is not in the call.
  assert.equal(await relaySignal(laptop, "call-1", "c1:X"), false);

  assert.deepEqual(sent(), [
    { to: phone.socketId, type: "call_signal", callId: "call-1", data: "c1:FROMANN" },
    { to: caller.socketId, type: "call_signal", callId: "call-1", data: "c1:FROMBOB" },
  ]);
});

test("no signals before the call is answered", async () => {
  assert.equal(await relaySignal(caller, "call-1", "c1:EARLY"), false);
  assert.equal(await keepCallAlive(caller, "call-1"), false);
});

test("declining ends the call for both and frees both users", async () => {
  await declineCall(laptop, "call-1");

  assert.deepEqual(sent(), [
    { to: caller.socketId, type: "call_ended", callId: "call-1", reason: "declined" },
    { to: "bob", type: "call_ended", callId: "call-1", reason: "declined" },
  ]);
  assert.equal(await state.getValue("call:call-1"), null);
  assert.equal(await state.getValue("call-user:ann"), null);
  assert.equal(await state.getValue("call-user:bob"), null);
});

test("hanging up tells only the other side", async () => {
  await answerCall(phone, "call-1", "c1:ANSWER");
  events = [];

  // Bob's laptop is not a side of the call.
  await hangUp(laptop, "call-1");
  assert.deepEqual(sent(), []);

  await hangUp(phone, "call-1");
  assert.deepEqual(sent(), [{ to: caller.socketId, type: "call_ended", callId: "call-1", reason: "hangup" }]);
  assert.equal(await state.getValue("call-user:bob"), null);
});

test("the caller cancels a ringing call on all the callee's devices", async () => {
  await hangUp(caller, "call-1");
  assert.deepEqual(sent(), [{ to: "bob", type: "call_ended", callId: "call-1", reason: "cancelled" }]);
});

test("a user's newer call is not freed by the end of an older one", async () => {
  await state.setValue("call-user:bob", "call-2", 60_000);
  await declineCall(phone, "call-1");

  assert.equal(await state.getValue("call-user:bob"), "call-2");
  assert.equal(await state.getValue("call-user:ann"), null);
});

test("a reconnected socket of the same session resumes the call", async () => {
  await answerCall(phone, "call-1", "c1:ANSWER");

  const reconnected = { ...phone, socketId: "bob-phone-socket-2" };
  assert.equal(await resumeCall(reconnected, "call-1"), true);
  // Another session of the same user cannot take it over.
  assert.equal(await resumeCall({ ...laptop, socketId: "x" }, "call-1"), false);

  events = [];
  await relaySignal(caller, "call-1", "c1:HI");
  assert.deepEqual(sent(), [{ to: "bob-phone-socket-2", type: "call_signal", callId: "call-1", data: "c1:HI" }]);
});

test("TURN logins are what coturn's use-auth-secret checks", () => {
  const now = Date.UTC(2026, 0, 1);
  const { username, credential } = turnLogin("secret", "user-1", now);

  assert.equal(username, `${now / 1000 + 6 * 60 * 60}:user-1`);
  assert.equal(credential, crypto.createHmac("sha1", "secret").update(username).digest("base64"));
});
