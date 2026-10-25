// Web: localStorage (guarded, since it is missing during static rendering
// and may throw in private browsing modes).

export async function getItem(key: string): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {}
}

export async function removeItem(key: string): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {}
}

// Removes the keys given, and on the web every other one of Ostrich's too
// (localStorage can be listed).
export async function removeItems(keys: string[]): Promise<void> {
  try {
    const all = globalThis.localStorage;

    if (!all) {
      return;
    }

    const ours = Array.from({ length: all.length }, (_, i) => all.key(i)).filter(
      (key): key is string => key !== null && key.startsWith("ostrich-"),
    );

    [...new Set([...keys, ...ours])].forEach((key) => all.removeItem(key));
  } catch {}
}
