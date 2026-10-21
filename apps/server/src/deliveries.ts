import { db } from "./database.js";
import { getMessage } from "./messages.js";
import { notifyNewMessage } from "./push.js";
import { sendToChatMembers } from "./realtime.js";

// Surprises (sealed letters kept from the other members until their time,
// messages.deliver_at): every few seconds the ones due are marked
// delivered and sent like new messages. Marking them takes the rows, so
// with several backend processes each is delivered once.
export const DELIVERY_INTERVAL_MS = 5_000;

const BATCH = 100;

export async function deliverDue() {
  const due = await db.query(
    `
    WITH due AS (
      UPDATE messages
      SET deliver_at = NULL
      WHERE id IN (
        SELECT id FROM messages
        WHERE deliver_at <= NOW()
        ORDER BY deliver_at
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, chat_id
    ),
    touched AS (
      UPDATE chats SET updated_at = NOW()
      WHERE id IN (SELECT chat_id FROM due)
    ),
    -- Like a new message, it shows the chat to members who had it hidden.
    shown AS (
      UPDATE chat_members SET hidden = FALSE
      WHERE chat_id IN (SELECT chat_id FROM due)
    )
    SELECT id FROM due
    `,
  );

  for (const { id } of due.rows) {
    const message = await getMessage(id);

    if (message) {
      notifyNewMessage(message.chat_id, message.sender_id, message.mentions);
      await sendToChatMembers(message.chat_id, { type: "message", message });
    }
  }

  return due.rows.length;
}
