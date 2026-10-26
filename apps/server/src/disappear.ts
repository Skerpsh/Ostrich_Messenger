import { db } from "./database.js";
import { createMessage } from "./messages.js";
import { notifyNewMessage, notifyUser } from "./push.js";
import { sendToChatMembers, sendToUserSockets } from "./realtime.js";

// "If I disappear": messages a user wrote ahead (encrypted on their
// device), sent for them when they have not opened Ostrich for the days
// they chose. Before that they are warned (a week, a day and an hour
// before, when the period is longer than that); opening Ostrich on any
// device starts the days again (POST /api/disappear/alive).

export const CHECK_INTERVAL_MS = 60_000;
export const MIN_DAYS = 2;
export const MAX_DAYS = 3650;
export const MAX_MESSAGES = 20;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Warning 1, 2, 3: this long before it goes off.
export const WARNINGS = [7 * DAY_MS, DAY_MS, HOUR_MS] as const;

const WARNING_TEXT = ["in 7 days", "tomorrow", "in an hour"] as const;

// The warning due `left` ms before going off, of a period of `days`: the
// last one passed (1–3), or 0. A warning longer than the period is never
// due (it would come at once).
export function warningDue(left: number, days: number) {
  let due = 0;

  WARNINGS.forEach((before, i) => {
    if (left <= before && before < days * DAY_MS) {
      due = i + 1;
    }
  });

  return due;
}

export function dueAt(lastActiveAt: Date, days: number) {
  return new Date(lastActiveAt.getTime() + days * DAY_MS);
}

// Sends a user's messages: their switch went off.
async function goOff(userId: string, days: number) {
  const messages = await db.query(
    "SELECT id, chat_id, content, attachments FROM disappear_messages WHERE user_id = $1 ORDER BY created_at",
    [userId],
  );

  for (const row of messages.rows) {
    const result = await createMessage(row.chat_id, userId, row.content, null, row.id, row.attachments, [], null, days);

    // Sent by an earlier try that was cut off before removing it.
    if ("error" in result && result.error === "duplicate_id") {
      await db.query("DELETE FROM disappear_messages WHERE id = $1", [row.id]);
      continue;
    }

    // Not sendable (left the chat, blocked, a new group key): kept, for
    // the user to see if they come back.
    if ("error" in result) {
      continue;
    }

    await db.query("DELETE FROM disappear_messages WHERE id = $1", [row.id]);
    notifyNewMessage(row.chat_id, userId, []);
    await sendToChatMembers(row.chat_id, { type: "message", message: result.message });
  }
}

// One round: warnings due and switches that go off. Each change is made
// only if nobody made it meanwhile (the user was not here since: their
// last time, to the millisecond as JavaScript has it), so with several
// backend processes it happens once.
export async function checkSwitches(now = new Date()) {
  const due = await db.query(
    `
    SELECT user_id, days, last_active_at, warned
    FROM disappear_switches
    WHERE triggered_at IS NULL
      AND last_active_at + make_interval(days => days) - INTERVAL '7 days' <= $1
    `,
    [now],
  );

  for (const row of due.rows) {
    const left = dueAt(row.last_active_at, row.days).getTime() - now.getTime();

    if (left <= 0) {
      const fired = await db.query(
        `
        UPDATE disappear_switches SET triggered_at = $3
        WHERE user_id = $1 AND triggered_at IS NULL AND date_trunc('milliseconds', last_active_at) = $2
        RETURNING user_id
        `,
        [row.user_id, row.last_active_at, now],
      );

      if (fired.rows.length > 0) {
        await goOff(row.user_id, row.days);
        sendToUserSockets(row.user_id, { type: "disappear" });
      }

      continue;
    }

    const warning = warningDue(left, row.days);

    if (warning > row.warned) {
      const warned = await db.query(
        `
        UPDATE disappear_switches SET warned = $3
        WHERE user_id = $1 AND warned < $3 AND date_trunc('milliseconds', last_active_at) = $2 AND triggered_at IS NULL
        RETURNING user_id
        `,
        [row.user_id, row.last_active_at, warning],
      );

      if (warned.rows.length > 0) {
        notifyUser(
          row.user_id,
          `"If I disappear" sends your messages ${WARNING_TEXT[warning - 1]}. Open Ostrich to stop it: the days start again.`,
          { disappear: "warning" },
        );
        sendToUserSockets(row.user_id, { type: "disappear" });
      }
    }
  }

  // Gone off, but the sending was cut short (an error, a restart): the
  // messages left are tried again for a day, while the user stays away.
  // A message already sent is not sent twice (its id, goOff).
  const unfinished = await db.query(
    `
    SELECT s.user_id, s.days
    FROM disappear_switches s
    WHERE s.triggered_at > $1::timestamptz - INTERVAL '1 day'
      AND EXISTS (SELECT 1 FROM disappear_messages d WHERE d.user_id = s.user_id)
      AND NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.user_id = s.user_id AND sessions.last_used_at > s.triggered_at)
    `,
    [now],
  );

  for (const row of unfinished.rows) {
    await goOff(row.user_id, row.days);
  }
}
