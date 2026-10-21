import { File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { PickedFile } from "./attachments";
import { newMessageId } from "@/crypto/crypto";
import { readUri } from "@/platform/files";
import { parseMeta, type PageMeta } from "./link-meta";

// Link previews are made on the phones only: the sender's app loads the
// page and its picture, and sends them inside the encrypted message, so
// the server never learns the link. Browsers cannot load other sites
// (link-preview.web.ts); they show the previews they receive.

export const MAKES_LINK_PREVIEWS = true;

const PAGE_TIMEOUT_MS = 6000;
const IMAGE_TIMEOUT_MS = 10_000;
// The tags are in the page's head: the rest is not read.
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_SIDE = 640;

type Loaded<T> = { body: T; type: string; url: string };

// Loads an address with XMLHttpRequest, which (unlike React Native's
// fetch) reports progress, so the size is bounded while loading: a page is
// cut at `max` bytes (its start is enough), a picture larger than that is
// given up. Also given up after `timeout` or when `signal` aborts.
function load(url: string, kind: "text", max: number, timeout: number, signal?: AbortSignal): Promise<Loaded<string> | null>;
function load(url: string, kind: "arraybuffer", max: number, timeout: number): Promise<Loaded<ArrayBuffer> | null>;
function load(
  url: string,
  kind: "text" | "arraybuffer",
  max: number,
  timeout: number,
  signal?: AbortSignal,
): Promise<Loaded<string | ArrayBuffer> | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let done = false;

    const finish = (result: Loaded<string | ArrayBuffer> | null) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        resolve(result);
      }
    };

    const stop = () => {
      xhr.abort();
      finish(null);
    };

    const loaded = (): Loaded<string | ArrayBuffer> => ({
      body: kind === "text" ? xhr.responseText : xhr.response,
      type: xhr.getResponseHeader("content-type") ?? "",
      url: xhr.responseURL || url,
    });

    const timer = setTimeout(stop, timeout);
    signal?.addEventListener("abort", stop);

    xhr.open("GET", url);
    xhr.responseType = kind;

    if (kind === "text") {
      xhr.setRequestHeader("Accept", "text/html,application/xhtml+xml");
    }

    xhr.onprogress = (event) => {
      if (event.loaded <= max) {
        return;
      }

      if (kind === "text") {
        // Enough of the page.
        const page = loaded();
        xhr.abort();
        finish(page);
      } else {
        stop();
      }
    };
    xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? loaded() : null);
    xhr.onerror = () => finish(null);
    xhr.send();
  });
}

// The title, description and picture address of a page; null if it is not
// a page or has no title.
export async function fetchLinkPreview(url: string, signal: AbortSignal): Promise<PageMeta | null> {
  const page = await load(url, "text", MAX_PAGE_BYTES, PAGE_TIMEOUT_MS, signal);

  if (!page || !/html/i.test(page.type)) {
    return null;
  }

  return parseMeta(page.body.slice(0, MAX_PAGE_BYTES), page.url);
}

// The page's picture, made small (JPEG, at most 640 px) to send with the
// message; null if it cannot be loaded.
export async function linkImage(url: string): Promise<PickedFile | null> {
  const image = await load(url, "arraybuffer", MAX_IMAGE_BYTES, IMAGE_TIMEOUT_MS);

  if (!image || !/^image\//i.test(image.type) || image.body.byteLength > MAX_IMAGE_BYTES) {
    return null;
  }

  const download = new File(Paths.cache, `link-${newMessageId()}`);
  let saved: string | null = null;

  try {
    download.write(new Uint8Array(image.body));

    const original = await ImageManipulator.manipulate(download.uri).renderAsync();
    const scale = Math.min(1, IMAGE_SIDE / Math.max(original.width, original.height, 1));
    const context = ImageManipulator.manipulate(download.uri);

    if (scale < 1) {
      context.resize({ width: Math.round(original.width * scale), height: Math.round(original.height * scale) });
    }

    const small = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.75 });
    saved = small.uri;

    return {
      bytes: await readUri(small.uri),
      name: "preview.jpg",
      mime: "image/jpeg",
      width: small.width,
      height: small.height,
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
