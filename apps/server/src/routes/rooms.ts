import { FastifyInstance } from "fastify";
import { usernameSchema } from "../accounts.js";
import { db } from "../database.js";
import { authenticate } from "../middleware/auth.js";
import { sendToChatMembers, sendToUserSockets } from "../realtime.js";
import { joinRoom, leaveRoom, listRooms, randomNickname, reportMessage } from "../rooms.js";

// Anonymous rooms (src/rooms.ts): the list, entering, leaving, reports.
// Inside a room, its messages go through the chats' routes as usual.
// These take :roomId, not :chatId, so they act as the real account.
const roomsRateLimit = {
  rateLimit: {
    max: 30,
    timeWindow: "1 minute",
  },
};

const roomParams = {
  type: "object",
  required: ["roomId"],
  properties: { roomId: { type: "string", format: "uuid" } },
} as const;

const JOIN_ERRORS = {
  not_found: [404, "Room not found"],
  already_in: [409, "You are already in this room"],
  full: [409, "The room is full"],
  name_taken: [409, "Someone in the room already has this name"],
} as const;

export default async function roomsRoutes(server: FastifyInstance) {
  // LIST: the rooms, the name the user had last time and a new random one.
  server.get("/api/rooms", { preHandler: authenticate }, async (request) => {
    const last = await db.query("SELECT last_room_nickname FROM users WHERE id = $1", [request.user.id]);

    return {
      rooms: await listRooms(request.user.id),
      last_nickname: last.rows[0]?.last_room_nickname ?? null,
      random_nickname: randomNickname(),
    };
  });

  // ANOTHER RANDOM NAME
  server.get("/api/rooms/nickname", { preHandler: authenticate, config: roomsRateLimit }, async () => ({
    nickname: randomNickname(),
  }));

  // ENTER under a name (the rules of usernames).
  server.post<{ Params: { roomId: string }; Body: { nickname: string } }>(
    "/api/rooms/:roomId/join",
    {
      preHandler: authenticate,
      config: roomsRateLimit,
      schema: {
        params: roomParams,
        body: {
          type: "object",
          required: ["nickname"],
          properties: { nickname: usernameSchema },
        },
      },
    },
    async (request, reply) => {
      const { roomId } = request.params;
      const result = await joinRoom(request.user.id, roomId, request.body.nickname);

      if ("error" in result) {
        const [status, error] = JOIN_ERRORS[result.error];
        return reply.status(status).send({ error, code: result.error });
      }

      // The others see one more in the room; the user's devices list it.
      await sendToChatMembers(roomId, { type: "chats_changed" });
      sendToUserSockets(request.user.id, { type: "chats_changed" });

      return reply.status(201).send({ chat_id: roomId, persona_id: result.personaId });
    },
  );

  // LEAVE: what the user wrote stays, under the name they had.
  server.post<{ Params: { roomId: string } }>(
    "/api/rooms/:roomId/leave",
    { preHandler: authenticate, config: roomsRateLimit, schema: { params: roomParams } },
    async (request, reply) => {
      if (!(await leaveRoom(request.user.id, request.params.roomId))) {
        return reply.status(404).send({ error: "You are not in this room" });
      }

      return { left: true };
    },
  );

  // REPORT a message of someone else in the room.
  server.post<{ Params: { roomId: string; messageId: string } }>(
    "/api/rooms/:roomId/messages/:messageId/report",
    {
      preHandler: authenticate,
      config: roomsRateLimit,
      schema: {
        params: {
          type: "object",
          required: ["roomId", "messageId"],
          properties: {
            roomId: { type: "string", format: "uuid" },
            messageId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      const { roomId, messageId } = request.params;
      const result = await reportMessage(request.user.id, roomId, messageId);

      if ("error" in result) {
        return result.error === "own_message"
          ? reply.status(400).send({ error: "You can't report your own message" })
          : reply.status(404).send({ error: "Message not found in this room" });
      }

      if (result.deleted) {
        await sendToChatMembers(roomId, { type: "message_deleted", chatId: roomId, messageId });
      }

      return { reported: true, deleted: result.deleted };
    },
  );
}
