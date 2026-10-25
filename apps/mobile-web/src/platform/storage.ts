import * as SecureStore from "expo-secure-store";

// iOS / Android: values are kept in the Keychain / Keystore.
// The web implementation lives in storage.web.ts.

export async function getItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function removeItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

// Removes the keys given (the Keychain / Keystore cannot list them).
export async function removeItems(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => SecureStore.deleteItemAsync(key).catch(() => {})));
}
