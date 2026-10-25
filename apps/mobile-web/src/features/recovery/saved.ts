import { getItem, removeItem, setItem } from "@/platform/storage";

// What a logged-out device keeps while it recovers an account through
// friends (app/recover.tsx): the request, its one-time private key and
// secret, across the day it waits. Not the password: it is asked again.
const REQUEST_KEY = "ostrich-recovery-request";

// Set after a recovery: the guardians' setup ended with the old
// OstrichID, so the chats list asks to choose them again (banner.tsx).
export const RECOVERED_KEY = "ostrich-recovered";

export type SavedRecovery = {
  id: string;
  secret: string;
  // base64, the one-time key the guardians seal their shares for.
  privateKey: string;
  publicKey: string;
  username: string;
  threshold: number;
  total: number;
  readyAt: string;
  expiresAt: string;
  // The new OstrichID, made before it is sent (see auth.tsx
  // signInRecovered).
  newId?: string;
};

export async function loadRecovery(): Promise<SavedRecovery | null> {
  try {
    const saved = await getItem(REQUEST_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export const saveRecovery = (recovery: SavedRecovery) => setItem(REQUEST_KEY, JSON.stringify(recovery));

export const forgetRecovery = () => removeItem(REQUEST_KEY);
