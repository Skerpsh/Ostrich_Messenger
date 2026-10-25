import type { PoolClient } from "pg";
import { db } from "./database.js";
import { notifyUser } from "./push.js";
import { sendToUsers } from "./realtime.js";

// Recovery through friends: the user's OstrichID split among friends
// ("guardians") on the user's device with Shamir's secret sharing, each
// share encrypted there for its guardian (apps/mobile-web/src/crypto/crypto.ts,
// apps/cli/recovery_crypto.go). The server keeps the sealed shares and
// never has the ID nor a share. To recover:
//   1. a new device, with the username and the password, asks with a
//      one-time key pair (POST /api/recovery/requests); the owner's devices
//      are warned and can cancel it for RECOVERY_DELAY_MS;
//   2. each guardian compares the request's code aloud with the one asking
//      (so neither an impostor nor the server can put its own key in) and
//      seals their share again for the request's key;
//   3. after the delay, with `threshold` approvals, the new device gets the
//      shares (with the secret only it has), puts the ID together, logs in
//      and gets a new OstrichID (POST /api/auth/ostrich-id), which ends the
//      old setup: its shares were of the old ID.
// The server's part: the delay, the warning, the password, and giving the
// shares only to the device that asked. Guardians who conspire could put
// the ID together without it, but they would still need the password.

export const MIN_GUARDIANS = 2;
export const MAX_GUARDIANS = 10;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const RECOVERY_DELAY_MS = DAY_MS;
export const REQUEST_TTL_MS = 7 * DAY_MS;
// Requests with the right password per account a day: each warns the
// owner and the guardians.
export const MAX_REQUESTS_PER_DAY = 3;

export type RequestState = "waiting" | "ready" | "cancelled" | "completed" | "expired";

// What a request is now; "ready": the shares can be given out.
export function requestState(
  request: { ready_at: Date; expires_at: Date; cancelled_at: Date | null; completed_at: Date | null },
  approvals: number,
  threshold: number,
  now = new Date(),
): RequestState {
  if (request.completed_at) {
    return "completed";
  }

  if (request.cancelled_at) {
    return "cancelled";
  }

  if (request.expires_at <= now) {
    return "expired";
  }

  return request.ready_at <= now && approvals >= threshold ? "ready" : "waiting";
}

// SQL: the request (alias r) is still going.
export const ACTIVE_REQUEST = "r.cancelled_at IS NULL AND r.completed_at IS NULL AND r.expires_at > NOW()";

// Who to tell about a change: the owner's devices and the guardians.
export async function recoveryAudience(client: PoolClient | typeof db, userId: string) {
  const result = await client.query(
    `
    SELECT s.guardian_id
    FROM recovery_shares s
    JOIN recovery_setups st ON st.id = s.setup_id
    WHERE st.user_id = $1
    `,
    [userId],
  );

  return [userId, ...result.rows.map((row) => row.guardian_id as string)];
}

export function announceRecovery(userIds: string[]) {
  sendToUsers([...new Set(userIds)], { type: "recovery" }).catch(() => {});
}

// Cancels the user's request that is going, if any; returns its id.
export async function cancelActiveRequests(client: PoolClient | typeof db, userId: string) {
  const result = await client.query(
    `
    UPDATE recovery_requests r SET cancelled_at = NOW()
    WHERE r.user_id = $1 AND ${ACTIVE_REQUEST}
    RETURNING r.id
    `,
    [userId],
  );

  return result.rows.map((row) => row.id as string);
}

// A new request: the owner's phones and the guardians' hear about it.
export function notifyNewRequest(ownerId: string, ownerName: string, guardians: string[]) {
  notifyUser(
    ownerId,
    "Someone is recovering your Ostrich account with your friends. If it is not you, cancel it now in Settings → Recovery through friends.",
    { recovery: "request" },
  );

  for (const guardian of guardians) {
    notifyUser(
      guardian,
      `@${ownerName} asks you to help recover their Ostrich account. Compare the code with them by voice before you approve.`,
      { recovery: "guardian" },
    );
  }
}

export function notifyNewGuardians(ownerName: string, guardians: string[]) {
  for (const guardian of guardians) {
    notifyUser(
      guardian,
      `@${ownerName} chose you as a guardian: if they lose their OstrichID, you can help them get back in.`,
      { recovery: "guardian" },
    );
  }
}
