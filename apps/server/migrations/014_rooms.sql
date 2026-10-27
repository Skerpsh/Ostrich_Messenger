-- Anonymous rooms (chats.type 'room', src/rooms.ts): public chats of up to
-- 50 people that anyone may enter and leave. Not end-to-end encrypted: the
-- room's key is kept here and handed to whoever enters, so the server can
-- read them, as the apps say. Clients encrypt with it like with a group's
-- key (epoch 0), so rooms reuse the groups' messages, files and reactions.
ALTER TABLE chats ADD COLUMN room_number INTEGER UNIQUE;
ALTER TABLE chats ADD COLUMN room_key TEXT;

-- Whoever enters a room gets a persona: a user row of its own, with the
-- name chosen for the room and no avatar, which is the room's member and
-- writes its messages. Others only ever see the persona; persona_of (the
-- real account) never leaves the server. A new one for every entry; it
-- stays after leaving, as the author of what it wrote.
ALTER TABLE users ADD COLUMN persona_of UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX users_persona_of_idx ON users (persona_of) WHERE persona_of IS NOT NULL;

-- Usernames stay unique among accounts; a persona's name only among those
-- in its room at the moment (src/rooms.ts).
DROP INDEX users_username_lower_key;
CREATE UNIQUE INDEX users_username_lower_key
  ON users (LOWER(username)) WHERE persona_of IS NULL;

-- The name the user had in a room last time, offered at the next entry.
ALTER TABLE users ADD COLUMN last_room_nickname VARCHAR(32);

-- Reports of room messages: three from different people delete the
-- message; three on someone's messages within ten minutes mute them, each
-- mute twice as long as the one before. By real accounts, so leaving and
-- entering again changes nothing. No link to the message: the report
-- still counts after the message is gone.
CREATE TABLE room_reports (
  message_id  UUID NOT NULL,
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, reporter_id)
);

CREATE INDEX room_reports_author_idx ON room_reports (author_id, created_at);

ALTER TABLE users ADD COLUMN room_muted_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN room_mutes INTEGER NOT NULL DEFAULT 0;
