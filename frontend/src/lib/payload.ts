// What a message carries inside its encryption. Usually just its text;
// forwarded messages and messages with files carry a small JSON object
// after a marker instead, so the server sees none of it. The CLI reads the
// same format (cli/payload.go).

const MARKER = "\u001eostrich1:";

// A file of a message: encrypted with its own key (crypto.ts) and
// uploaded under its id.
export type Attachment = {
  id: string;
  // base64 of the file key.
  key: string;
  name: string;
  mime: string;
  // Bytes, before encryption.
  size: number;
  // Pictures: their size in pixels.
  width?: number;
  height?: number;
  // Voice messages (lib/voice.ts): length in milliseconds and the loudness
  // along it, base64 of one byte (0–255) per bar.
  duration?: number;
  waveform?: string;
};

export type Payload = {
  text: string;
  // The username a forwarded message comes from.
  forwardedFrom?: string;
  attachments?: Attachment[];
  // A preview of the first link of the text, made by the sender's app
  // (lib/link-preview.ts).
  link?: LinkPreview;
  // The chat's entry for a call, sent by the caller's app when it ends
  // (lib/calls.ts); `text` says the same for clients that do not know it.
  call?: CallEntry;
};

export type CallOutcome = "answered" | "missed" | "declined";

export type CallEntry = {
  id: string;
  outcome: CallOutcome;
  // Answered calls: how long they lasted, in milliseconds.
  duration?: number;
};

export type LinkPreview = {
  url: string;
  title: string;
  description?: string;
  site?: string;
  // The page's picture, encrypted and uploaded like a file.
  image?: Attachment;
};

// What is kept of a page's texts.
export const LINK_LIMITS = { title: 200, description: 400, site: 80 };

type WireAttachment = {
  i: string;
  k: string;
  n: string;
  m: string;
  s: number;
  w?: number;
  h?: number;
  d?: number;
  v?: string;
};
type WireLink = { u: string; t: string; d?: string; s?: string; i?: WireAttachment };
type WireCall = { i: string; o: CallOutcome; d?: number };
type Wire = { t: string; f?: string; a?: WireAttachment[]; l?: WireLink; c?: WireCall };

const wireAttachment = (a: Attachment): WireAttachment => ({
  i: a.id,
  k: a.key,
  n: a.name,
  m: a.mime,
  s: a.size,
  ...(a.width && a.height ? { w: a.width, h: a.height } : {}),
  ...(a.duration !== undefined ? { d: Math.round(a.duration) } : {}),
  ...(a.waveform ? { v: a.waveform } : {}),
});

export function encodePayload(payload: Payload): string {
  const attachments = payload.attachments ?? [];

  if (!payload.forwardedFrom && attachments.length === 0 && !payload.link && !payload.call) {
    return payload.text;
  }

  const wire: Wire = { t: payload.text };

  if (payload.forwardedFrom) {
    wire.f = payload.forwardedFrom;
  }

  if (attachments.length > 0) {
    wire.a = attachments.map(wireAttachment);
  }

  if (payload.link) {
    const { url, title, description, site, image } = payload.link;
    wire.l = {
      u: url,
      t: title,
      ...(description ? { d: description } : {}),
      ...(site ? { s: site } : {}),
      ...(image ? { i: wireAttachment(image) } : {}),
    };
  }

  if (payload.call) {
    const { id, outcome, duration } = payload.call;
    wire.c = { i: id, o: outcome, ...(duration !== undefined ? { d: Math.round(duration) } : {}) };
  }

  return MARKER + JSON.stringify(wire);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readAttachment(value: unknown): Attachment | null {
  const a = value as Partial<WireAttachment> | null;

  if (
    !a ||
    typeof a.i !== "string" ||
    !UUID_RE.test(a.i) ||
    typeof a.k !== "string" ||
    typeof a.n !== "string" ||
    typeof a.m !== "string" ||
    typeof a.s !== "number"
  ) {
    return null;
  }

  return {
    id: a.i,
    key: a.k,
    name: a.n,
    mime: a.m,
    size: a.s,
    ...(typeof a.w === "number" && typeof a.h === "number" ? { width: a.w, height: a.h } : {}),
    ...(typeof a.d === "number" && Number.isFinite(a.d) && a.d >= 0 ? { duration: a.d } : {}),
    ...(typeof a.v === "string" && a.v.length <= 512 ? { waveform: a.v } : {}),
  };
}

const text = (value: unknown, limit: number) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : undefined;

// Only a preview of a link in the message's text: the card opens its url,
// so it must not lead somewhere the text does not show.
function readLink(value: unknown, messageText: string): LinkPreview | null {
  const l = value as Partial<WireLink> | null;
  const title = text(l?.t, LINK_LIMITS.title);

  if (
    !l ||
    typeof l.u !== "string" ||
    !/^https?:\/\/\S+$/i.test(l.u) ||
    l.u.length > 2048 ||
    !messageText.includes(l.u) ||
    !title
  ) {
    return null;
  }

  const description = text(l.d, LINK_LIMITS.description);
  const site = text(l.s, LINK_LIMITS.site);
  const image = l.i ? readAttachment(l.i) : null;

  return {
    url: l.u,
    title,
    ...(description ? { description } : {}),
    ...(site ? { site } : {}),
    ...(image && /^image\//.test(image.mime) ? { image } : {}),
  };
}

const OUTCOMES = new Set<string>(["answered", "missed", "declined"]);

function readCall(value: unknown): CallEntry | null {
  const c = value as Partial<WireCall> | null;

  if (!c || typeof c.i !== "string" || !UUID_RE.test(c.i) || typeof c.o !== "string" || !OUTCOMES.has(c.o)) {
    return null;
  }

  return {
    id: c.i,
    outcome: c.o,
    ...(typeof c.d === "number" && Number.isFinite(c.d) && c.d >= 0 ? { duration: c.d } : {}),
  };
}

// Anything that is not a well-formed payload is shown as text; malformed
// attachments and link previews are left out.
export function decodePayload(plain: string): Payload {
  if (!plain.startsWith(MARKER)) {
    return { text: plain };
  }

  try {
    const wire = JSON.parse(plain.slice(MARKER.length)) as Partial<Wire>;

    if (typeof wire.t !== "string") {
      return { text: plain };
    }

    const attachments = Array.isArray(wire.a)
      ? wire.a.map(readAttachment).filter((a): a is Attachment => a !== null)
      : [];

    const link = wire.l ? readLink(wire.l, wire.t) : null;
    const call = wire.c ? readCall(wire.c) : null;

    return {
      text: wire.t,
      ...(typeof wire.f === "string" && wire.f ? { forwardedFrom: wire.f } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(link ? { link } : {}),
      ...(call ? { call } : {}),
    };
  } catch {
    return { text: plain };
  }
}
