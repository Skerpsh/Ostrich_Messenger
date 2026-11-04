import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import avatarsRoutes from "../src/routes/avatars.js";

test("a guest's picture is refused before it is read", async () => {
  const server = Fastify();
  await server.register(avatarsRoutes);

  // Over the size limit: read first, it would be answered 413.
  const response = await server.inject({
    method: "PUT",
    url: "/api/users/me/avatar",
    headers: { "content-type": "image/png" },
    payload: Buffer.alloc(9 * 1024 * 1024),
  });

  assert.equal(response.statusCode, 401);
  await server.close();
});
