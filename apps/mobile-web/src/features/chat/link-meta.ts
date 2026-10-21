// Reading a link preview out of a page: its Open Graph tags (og:title, …)
// or else its <title> and description. Used by link-preview.ts; no
// network here, so it can be tested.

import { LINK_RE } from "./markup.ts";

// The first web address in a message (the first link markup.ts shows).
export function firstLink(text: string): string | null {
  const match = LINK_RE.exec(text);
  return match ? match[0] : null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : entity;
    }

    return ENTITIES[name.toLowerCase()] ?? entity;
  });
}

const clean = (value: string | undefined) =>
  value ? decodeEntities(value).replace(/\s+/g, " ").trim() || undefined : undefined;

function attribute(tag: string, name: string) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

export type PageMeta = { title: string; description?: string; site?: string; image?: string };

// The preview of a page at `url` from its HTML; null if it has no title.
export function parseMeta(html: string, url: string): PageMeta | null {
  const head = html.slice(0, 300_000);
  const meta = new Map<string, string>();

  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attribute(tag, "property") ?? attribute(tag, "name"))?.toLowerCase();
    const content = attribute(tag, "content");

    if (key && content !== undefined && !meta.has(key)) {
      meta.set(key, content);
    }
  }

  const title = clean(
    meta.get("og:title") ?? meta.get("twitter:title") ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1],
  );

  if (!title) {
    return null;
  }

  const description = clean(meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description"));
  const site = clean(meta.get("og:site_name")) ?? hostOf(url);
  let image: string | undefined;

  const imageUrl = clean(meta.get("og:image:secure_url") ?? meta.get("og:image") ?? meta.get("twitter:image"));

  if (imageUrl) {
    try {
      const absolute = new URL(imageUrl, url);
      image = /^https?:$/.test(absolute.protocol) ? absolute.href : undefined;
    } catch {}
  }

  return {
    title,
    ...(description && description !== title ? { description } : {}),
    ...(site ? { site } : {}),
    ...(image ? { image } : {}),
  };
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
