// Web: localStorage (guarded, since it is missing during static rendering
// and may throw in private browsing modes). In the desktop app the values
// are encrypted with the system's keyring (apps/desktop/main.js), where
// there is one; in a browser they are not, nothing there could keep a key
// from whoever copies the profile (the App lock screen says so).

type Keyring = {
  encrypt: (text: string) => Promise<string | null>;
  decrypt: (data: string) => Promise<string>;
};

const keyring = (globalThis as { ostrichDesktop?: Partial<Keyring> }).ostrichDesktop;
// Marks an encrypted value; others were written before, or without a keyring.
const SEALED = "\u0001sealed:";

function read(key: string) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

async function seal(value: string) {
  const sealed = keyring?.encrypt ? await keyring.encrypt(value) : null;
  return sealed === null ? value : SEALED + sealed;
}

export async function getItem(key: string): Promise<string | null> {
  const value = read(key);

  if (value === null || !keyring?.decrypt) {
    return value;
  }

  if (!value.startsWith(SEALED)) {
    // Written before: encrypted now, unless it changed meanwhile.
    seal(value)
      .then((sealed) => read(key) === value && globalThis.localStorage?.setItem(key, sealed))
      .catch(() => {});
    return value;
  }

  try {
    return await keyring.decrypt(value.slice(SEALED.length));
  } catch {
    // The keyring is gone or changed: logged out, and the account's key
    // comes back from the server at login. Kept, should the keyring return.
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(key, await seal(value));
  } catch {}
}

// Whether what is stored here is encrypted (in the desktop app with a keyring).
export async function storageEncrypted(): Promise<boolean> {
  try {
    return Boolean(keyring?.encrypt) && (await keyring!.encrypt!("")) !== null;
  } catch {
    return false;
  }
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
