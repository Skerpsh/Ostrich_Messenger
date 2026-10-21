import type { PickedFile } from "./attachments";
import type { PageMeta } from "./link-meta";

// Browsers cannot load other sites (CORS, and the app's Content Security
// Policy allows only its own server): the web app makes no link previews,
// it only shows those sent from the phones. See link-preview.ts.

export const MAKES_LINK_PREVIEWS = false;

export async function fetchLinkPreview(_url: string, _signal: AbortSignal): Promise<PageMeta | null> {
  return null;
}

export async function linkImage(_url: string): Promise<PickedFile | null> {
  return null;
}
