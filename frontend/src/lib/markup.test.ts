/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { mentionedUsernames, parseMarkup, plainText } from "./markup.ts";
import { readFileSync } from "node:fs";
import { decodePayload, encodePayload } from "./payload.ts";
import { firstLink, parseMeta } from "./link-meta.ts";

test("formatting", () => {
  assert.deepEqual(parseMarkup("a **b** c"), [
    { text: "a " },
    { text: "b", bold: true },
    { text: " c" },
  ]);
  assert.deepEqual(parseMarkup("_it_ and *it* ~~s~~ `x * y`"), [
    { text: "it", italic: true },
    { text: " and " },
    { text: "it", italic: true },
    { text: " " },
    { text: "s", strike: true },
    { text: " " },
    { text: "x * y", code: true },
  ]);
  assert.deepEqual(parseMarkup("**bold _both_**"), [
    { text: "bold ", bold: true },
    { text: "both", bold: true, italic: true },
  ]);
  assert.deepEqual(parseMarkup("```\nconst a = 1;\n```"), [{ text: "const a = 1;", code: true }]);
});

test("no formatting where it is not meant", () => {
  for (const text of ["snake_case_name", "2 * 3 * 4", "** not bold **", "a_b", "*", "**"]) {
    assert.equal(plainText(text), text, text);
  }
});

test("links", () => {
  assert.deepEqual(parseMarkup("see https://example.com/a?b=1."), [
    { text: "see " },
    { text: "https://example.com/a?b=1", link: "https://example.com/a?b=1" },
    { text: "." },
  ]);
  assert.deepEqual(parseMarkup("(https://x.org)"), [
    { text: "(" },
    { text: "https://x.org", link: "https://x.org" },
    { text: ")" },
  ]);
});

test("payloads", () => {
  assert.equal(encodePayload({ text: "hi" }), "hi");
  assert.deepEqual(decodePayload("hi"), { text: "hi" });

  const forwarded = encodePayload({ text: "hi", forwardedFrom: "alice" });
  assert.deepEqual(decodePayload(forwarded), { text: "hi", forwardedFrom: "alice" });

  // Broken payloads show as text.
  assert.deepEqual(decodePayload("\u001eostrich1:{oops"), { text: "\u001eostrich1:{oops" });
});

test("voice messages", () => {
  // The same as cli/markup_test.go.
  const plain =
    '\u001eostrich1:{"t":"","a":[{"i":"6f2b4ad0-8a3e-4c51-9d7b-1e2f3a4b5c6d","k":"a2V5","n":"voice.m4a","m":"audio/mp4","s":5000,"d":7300,"v":"AH//"}]}';
  const payload = decodePayload(plain);

  assert.deepEqual(payload.attachments?.[0], {
    id: "6f2b4ad0-8a3e-4c51-9d7b-1e2f3a4b5c6d",
    key: "a2V5",
    name: "voice.m4a",
    mime: "audio/mp4",
    size: 5000,
    duration: 7300,
    waveform: "AH//",
  });
  assert.equal(encodePayload(payload), plain);
});

test("payloads with attachments", () => {
  const v = JSON.parse(
    readFileSync(new URL("../../../testdata/crypto-vectors.json", import.meta.url), "utf8"),
  );
  const payload = decodePayload(v.payload_with_attachments);

  assert.equal(payload.text, "caption");
  assert.equal(payload.forwardedFrom, "carol");
  assert.deepEqual(payload.attachments, [
    {
      id: "6f2b4ad0-8a3e-4c51-9d7b-1e2f3a4b5c6d",
      key: v.attachment_key,
      name: "photo.jpg",
      mime: "image/jpeg",
      size: 110,
      width: 640,
      height: 480,
    },
  ]);
  assert.equal(encodePayload(payload), v.payload_with_attachments);

  // Malformed attachments are left out.
  const broken = '\u001eostrich1:{"t":"x","a":[{"i":"nope"},{"i":1}]}';
  assert.deepEqual(decodePayload(broken), { text: "x" });
});

// The same cases as the CLI's (cli/markup_test.go).
test("mentions", () => {
  const { mentions } = JSON.parse(
    readFileSync(new URL("../../../testdata/markup-mentions.json", import.meta.url), "utf8"),
  ) as { mentions: [string, string[]][] };

  for (const [text, want] of mentions) {
    const got = parseMarkup(text)
      .filter((span) => span.mention && !span.code)
      .map((span) => span.mention);
    assert.deepEqual(got, want, text);
  }

  assert.deepEqual(mentionedUsernames("@Bob and @bob"), ["bob"]);
});

test("link previews", () => {
  assert.equal(firstLink("see https://example.com/a?b=1, ok"), "https://example.com/a?b=1");
  assert.equal(firstLink("no links"), null);

  const html = `<html><head><title>Fallback</title>
    <meta property="og:title" content="Tom &amp; Jerry">
    <meta content='A &quot;cat&quot; and a mouse' name="description">
    <meta property="og:image" content="/img/cover.png">
    </head></html>`;

  assert.deepEqual(parseMeta(html, "https://www.example.com/page"), {
    title: "Tom & Jerry",
    description: 'A "cat" and a mouse',
    site: "example.com",
    image: "https://www.example.com/img/cover.png",
  });
  assert.equal(parseMeta("<p>no title</p>", "https://example.com"), null);
  assert.equal(parseMeta(`<title>x</title><meta property="og:image" content="javascript:alert(1)">`, "https://a.b")?.image, undefined);

  // Sent inside the message; a bad one is left out.
  const link = { url: "https://example.com", title: "Example", site: "example.com" };
  assert.deepEqual(decodePayload(encodePayload({ text: "https://example.com", link })).link, link);
  assert.equal(decodePayload('\u001eostrich1:{"t":"x","l":{"u":"javascript:alert(1)","t":"x"}}').link, undefined);
  // Not a link of the text: a card could lead elsewhere than the text shows.
  assert.equal(
    decodePayload('\u001eostrich1:{"t":"https://bank.example","l":{"u":"https://evil.example","t":"Bank"}}').link,
    undefined,
  );
});
