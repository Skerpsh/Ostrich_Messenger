-- Logging in on a new device by scanning its QR code with a device that is
-- logged in (backend/src/routes/device-links.ts). A request lives for a
-- few minutes; the account's private key reaches the new device
-- encrypted for a key only that device has.
CREATE TABLE device_links (
  id UUID PRIMARY KEY,
  -- SHA-256 of the secret only the new device knows (it fetches the
  -- session with it; the QR code does not contain it).
  secret_hash TEXT NOT NULL,
  -- The app asking, for the approving device to show.
  client TEXT NOT NULL,
  -- Set when approved: whose session to create, and the private key
  -- encrypted for the new device with the approving device's one-time key.
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  sealed_key TEXT,
  sealer_public_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX device_links_expires_at_idx ON device_links (expires_at);
