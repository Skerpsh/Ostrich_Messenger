/// <reference types="node" />
// npm test. The desktop app's storage, encrypted with a stand-in for the
// system's keyring (apps/desktop/main.js).
import assert from "node:assert/strict";
import { test } from "node:test";

const local = new Map<string, string>();
let keyringUp = true;

Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => void local.set(key, value),
    removeItem: (key: string) => void local.delete(key),
  },
  ostrichDesktop: {
    encrypt: async (text: string) => Buffer.from(`k:${text}`).toString("base64"),
    decrypt: async (data: string) => {
      const text = Buffer.from(data, "base64").toString();
      if (!keyringUp || !text.startsWith("k:")) throw new Error("cannot decrypt");
      return text.slice(2);
    },
  },
});

const { getItem, setItem, storageEncrypted } = await import("./storage.web.ts");

test("values are kept encrypted and read back", async () => {
  await setItem("ostrich-token", "secret");
  assert.ok(!local.get("ostrich-token")!.includes("secret"));
  assert.equal(await getItem("ostrich-token"), "secret");
  assert.equal(await storageEncrypted(), true);
});

test("a value written before is read and then encrypted", async () => {
  local.set("ostrich-private-key", "old");
  assert.equal(await getItem("ostrich-private-key"), "old");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.notEqual(local.get("ostrich-private-key"), "old");
  assert.equal(await getItem("ostrich-private-key"), "old");
});

test("without the keyring nothing is read, and nothing is lost", async () => {
  await setItem("ostrich-user", "me");
  const sealed = local.get("ostrich-user");
  keyringUp = false;
  assert.equal(await getItem("ostrich-user"), null);
  assert.equal(local.get("ostrich-user"), sealed);
  keyringUp = true;
  assert.equal(await getItem("ostrich-user"), "me");
});
