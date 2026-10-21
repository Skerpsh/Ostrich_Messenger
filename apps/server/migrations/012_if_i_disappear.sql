-- "If I disappear" (src/disappear.ts): messages a user wrote ahead, sent
-- for them when they have not opened Ostrich for `days` days. The messages
-- are encrypted on the user's device like any other (for their chats);
-- the server keeps the ciphertext and when to send it.
CREATE TABLE disappear_switches (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  days           INTEGER NOT NULL CHECK (days BETWEEN 2 AND 3650),
  -- The last time the user opened Ostrich (the apps tell the server).
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Warnings sent since then: 1 a week before, 2 a day before, 3 an hour before.
  warned         SMALLINT NOT NULL DEFAULT 0,
  -- When it went off (its messages were sent); it is off from then on.
  triggered_at   TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE disappear_messages (
  -- The message's id, chosen by the client: its encryption is bound to it.
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  attachments UUID[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX disappear_messages_user_id_idx ON disappear_messages (user_id);

-- Sent by "If I disappear": the days the sender had not opened Ostrich.
ALTER TABLE messages ADD COLUMN sent_after_days INTEGER;
