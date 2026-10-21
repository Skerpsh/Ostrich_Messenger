# Security policy

Ostrich is an end-to-end encrypted messenger, so security reports matter to
us more than any other kind.

## Reporting a vulnerability

**Do not open a public issue.** Report it privately through GitHub:
**Security** tab → **Report a vulnerability**
([direct link](https://github.com/Skerpsh/Ostrich_Messenger/security/advisories/new)),
or by email to **[security@ostrich-messenger.com](mailto:security@ostrich-messenger.com)**.

Please include:

- what an attacker can do (read messages, impersonate a user, take over an
  account, crash the server, ...) and what they need for it (a malicious
  server, a member of the chat, network access, ...);
- steps to reproduce or a proof of concept;
- the affected part: backend, web/mobile app, CLI or the encryption scheme.

You should get an answer within a few days. Once a fix is released, we are
happy to credit you in the release notes if you want.

## Scope

Especially interesting:

- anything that lets the **server** or a network attacker read, change,
  reorder, replay or forge messages, files or group data, or listen in on a
  call without the Ostrich handshake noticing
  ([`apps/mobile-web/src/features/calls/handshake.ts`](apps/mobile-web/src/features/calls/handshake.ts));
- weaknesses in the encryption scheme
  ([`apps/mobile-web/src/crypto/crypto.ts`](apps/mobile-web/src/crypto/crypto.ts),
  [`apps/cli/crypto.go`](apps/cli/crypto.go)) or differences between the two
  implementations;
- ways to get the OstrichID or a private key off a device;
- authentication, session and access-control bugs in the API.

Known limitations, by design:

- The server sees metadata: who talks to whom, when (calls included),
  message sizes, IP addresses and profile photos. A call that goes straight
  between the devices shows each one the other's IP address.
- Inside a group, members share the group key, so a member working with the
  server could make a message look like another member's.
- Without comparing safety codes, the first key a client sees for a contact
  is trusted.

## Status

Ostrich has **not** had an independent security audit. Use it with that in
mind.
