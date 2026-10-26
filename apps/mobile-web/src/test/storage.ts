// Stands in for platform/storage.ts in the tests: kept in memory, and like
// the Keychain / Keystore, removeItems removes only the keys given.
export const stored = new Map<string, string>();

export async function getItem(key: string): Promise<string | null> {
  return stored.get(key) ?? null;
}

export async function setItem(key: string, value: string): Promise<void> {
  stored.set(key, value);
}

export async function removeItem(key: string): Promise<void> {
  stored.delete(key);
}

export async function removeItems(keys: string[]): Promise<void> {
  keys.forEach((key) => stored.delete(key));
}
