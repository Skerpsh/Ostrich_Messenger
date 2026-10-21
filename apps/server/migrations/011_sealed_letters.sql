-- Sealed letters sent as a surprise (apps/server/src/deliveries.ts): kept
-- from the other members until deliver_at, which is also their created_at;
-- NULL once delivered and for every other message. The letter itself is
-- time-locked inside its encryption, so the server could not read it even
-- if it delivered it early.
ALTER TABLE messages ADD COLUMN deliver_at TIMESTAMPTZ;

CREATE INDEX messages_deliver_at_idx ON messages (deliver_at)
  WHERE deliver_at IS NOT NULL;
