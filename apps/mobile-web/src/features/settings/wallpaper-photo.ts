import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { fromBase64, toBase64 } from "@/crypto/crypto";

// Photos for chat wallpapers: picked from the library, made at most
// MAX_SIDE pixels on the long side (JPEG), and kept on the device as data
// URIs in the local cache (platform/cache.ts).

const MAX_SIDE = 1600;

export type WallpaperPhoto = { uri: string; width: number; height: number };

// Null if cancelled.
export async function pickWallpaperPhoto(): Promise<WallpaperPhoto | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1,
  });

  if (result.canceled || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  const scale = Math.min(1, MAX_SIDE / Math.max(asset.width, asset.height));
  const width = Math.round(asset.width * scale);
  const height = Math.round(asset.height * scale);

  const context = ImageManipulator.manipulate(asset.uri);
  context.resize({ width, height });

  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });

  if (!saved.base64) {
    throw new Error("Could not read the photo");
  }

  return { uri: `data:image/jpeg;base64,${saved.base64}`, width, height };
}

// The photo's bytes, to send it (encrypted) to a chat.
export function photoBytes(uri: string): Uint8Array {
  return fromBase64(uri.slice(uri.indexOf(",") + 1));
}

// A received photo as a data URI.
export function photoUri(bytes: Uint8Array, mime: string) {
  return `data:${mime};base64,${toBase64(bytes)}`;
}
