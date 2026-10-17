import { File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { PickedFile } from "./attachments";
import { newMessageId } from "./crypto";
import { readUri } from "./files";
import { parseMeta, type PageMeta } from "./link-meta";

// Link previews are made on the phones only: the sender's app loads the
// page and its picture, and sends them inside the encrypted message, so
// the server never learns the link. Browsers cannot load other sites
// (link-preview.web.ts); they show the previews they receive.

export const MAKES_LINK_PREVIEWS = true;

const TIMEOUT_MS = 6000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_SIDE = 640;

// The title, description and picture address of a page; null if it is not
// a page or has no title.
export async function fetchLinkPreview(url: string, signal: AbortSignal): Promise<PageMeta | null> {
  // Stopped by the caller or after a while (React Native has no
  // AbortSignal.any / timeout).
  const controller = new AbortController();
  const stop = () => controller.abort();
  const timer = setTimeout(stop, TIMEOUT_MS);
  signal.addEventListener("abort", stop);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });

    if (!response.ok || !/html/i.test(response.headers.get("content-type") ?? "")) {
      return null;
    }

    return parseMeta(await response.text(), response.url || url);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

// The page's picture, made small (JPEG, at most 640 px) to send with the
// message; null if it cannot be loaded.
export async function linkImage(url: string): Promise<PickedFile | null> {
  const download = new File(Paths.cache, `link-${newMessageId()}`);
  let saved: string | null = null;

  try {
    await File.downloadFileAsync(url, download, { idempotent: true });

    if ((download.size ?? 0) > MAX_IMAGE_BYTES) {
      return null;
    }

    const original = await ImageManipulator.manipulate(download.uri).renderAsync();
    const scale = Math.min(1, IMAGE_SIDE / Math.max(original.width, original.height, 1));
    const context = ImageManipulator.manipulate(download.uri);

    if (scale < 1) {
      context.resize({ width: Math.round(original.width * scale), height: Math.round(original.height * scale) });
    }

    const image = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.75 });
    saved = image.uri;

    return {
      bytes: await readUri(image.uri),
      name: "preview.jpg",
      mime: "image/jpeg",
      width: image.width,
      height: image.height,
    };
  } catch {
    return null;
  } finally {
    for (const uri of [download.uri, saved]) {
      try {
        const file = uri ? new File(uri) : null;

        if (file?.exists) {
          file.delete();
        }
      } catch {}
    }
  }
}
