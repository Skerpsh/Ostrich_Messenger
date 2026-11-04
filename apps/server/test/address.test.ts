import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { addressKey } from "../src/address.js";

test("IPv6 addresses count by their /64, however they are written", () => {
  const key = "2001:db8:1:2::/64";

  assert.equal(addressKey("2001:db8:1:2::1"), key);
  assert.equal(addressKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), key);
  assert.equal(addressKey("2001:0DB8:0001:0002::ffff"), key);
  assert.equal(addressKey("2001:db8:1:2::1%eth0"), key);
  assert.notEqual(addressKey("2001:db8:1:3::1"), key);
  assert.equal(addressKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(addressKey("::1"), "0:0:0:0::/64");
});

test("IPv4 addresses count as they are, also when written as IPv6", () => {
  assert.equal(addressKey("203.0.113.5"), "203.0.113.5");
  assert.equal(addressKey("::ffff:203.0.113.5"), "203.0.113.5");
});

test("a route with its own limit counts by the /64 too", async () => {
  const server = Fastify();
  await server.register(rateLimit, { max: 100, timeWindow: "1 minute", keyGenerator: (request) => addressKey(request.ip) });
  server.get("/own", { config: { rateLimit: { max: 1, timeWindow: "1 minute" } } }, async () => "ok");

  const get = async (remoteAddress: string) => (await server.inject({ url: "/own", remoteAddress })).statusCode;

  assert.equal(await get("2001:db8:1:2::1"), 200);
  assert.equal(await get("2001:db8:1:2::2"), 429);
  assert.equal(await get("2001:db8:1:3::1"), 200);
  await server.close();
});
