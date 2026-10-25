-- Recovery through friends (src/routes/recovery.ts): the user's OstrichID
-- split with Shamir's secret sharing among friends ("guardians") on the
-- user's device; each share is encrypted there for its guardian's public
-- key, so the server never sees a share nor the ID.

-- One per user: how many shares give the ID back. `id` is chosen by the
-- client: the shares' encryption is bound to it.
CREATE TABLE recovery_setups (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id         UUID NOT NULL UNIQUE,
  threshold  SMALLINT NOT NULL CHECK (threshold >= 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A guardian's share, sealed for them with a one-time key of the owner's
-- device (sealer_public).
CREATE TABLE recovery_shares (
  setup_id      UUID NOT NULL REFERENCES recovery_setups(id) ON DELETE CASCADE,
  guardian_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sealed        TEXT NOT NULL,
  sealer_public TEXT NOT NULL,
  PRIMARY KEY (setup_id, guardian_id)
);

CREATE INDEX recovery_shares_guardian_id_idx ON recovery_shares (guardian_id);

-- Someone who knows the password asks to recover the account from a new
-- device, with a one-time key pair (public_key; its code is compared aloud
-- with each guardian). The shares the guardians seal again for that key
-- are given out, to the holder of the secret, only after ready_at (a day
-- in which the owner's devices can cancel it). Active while not
-- cancelled, completed nor older than a week.
CREATE TABLE recovery_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL once the setup is gone (requests are cancelled with it); kept
  -- for the limit of requests a day.
  setup_id     UUID REFERENCES recovery_setups(id) ON DELETE SET NULL,
  secret_hash  TEXT NOT NULL,
  public_key   TEXT NOT NULL,
  client       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at     TIMESTAMPTZ NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX recovery_requests_user_id_idx ON recovery_requests (user_id, created_at);

-- A guardian's share, sealed again for the request's public key.
CREATE TABLE recovery_approvals (
  request_id    UUID NOT NULL REFERENCES recovery_requests(id) ON DELETE CASCADE,
  guardian_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sealed        TEXT NOT NULL,
  sealer_public TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (request_id, guardian_id)
);
