-- Settings a user chose to sync between their devices (theme, accent,
-- wallpapers, text size, ...), encrypted on the device with a key derived
-- from the account's private key (frontend/src/lib/crypto.ts): the server
-- stores ciphertext only. One row per user, replaced on every change.
CREATE TABLE user_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
