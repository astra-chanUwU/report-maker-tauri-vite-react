# Report Maker control plane

The control plane is a small HTTPS service for licensing, hosted AI, and
consented diagnostics. It is not the report database and it does not receive
`.sp3` files by default. The desktop app remains useful offline.

## Customer identity at checkout

Checkout normalizes email to lowercase trimmed form and **find-or-creates** one
durable customer row per email. Repeat purchases with the same email link to the
same account used by magic-link and passkey sign-in.

When checkout contact differs from an account with **verified phone**
(`phone_verified_at` set):

- stored phone and surname are **not** overwritten;
- checkout still captures the submitted name/phone on the **order** row for receipts;
- conflicts are recorded internally for support review.

Unverified accounts accept checkout contact updates (name and phone).

## Boundaries

- The Tauri Rust layer is the client security boundary. React displays status
  and invokes Rust commands; it does not verify licenses or hold long-lived
  secrets.
- The server is the authority for activation, device limits, revocation,
  feature entitlements, AI quotas, and telemetry ingestion.
- The server signs short-lived offline leases with Ed25519. The private signing
  key never ships in the app. The app ships only the public verification key.
- Report files, spectra, paths, project names, engineer names, and report text
  stay local unless a future user action explicitly opts into sending data.

## API v1

All endpoints use JSON over HTTPS. Error responses use:

```json
{ "error": { "code": "machine_readable_code", "message": "Safe user-facing text" } }
```

### Activate a device

`POST /v1/activations`

Request:

```json
{
  "license_key": "RM-...",
  "device_public_key": "base64url-ed25519-public-key",
  "app_version": "0.1.0",
  "platform": "macos"
}
```

Response:

```json
{
  "activation_id": "act_...",
  "lease": {
    "lease_version": 1,
    "key_id": "lease-2026-01",
    "license_id": "lic_...",
    "activation_id": "act_...",
    "device_public_key": "base64url-ed25519-public-key",
    "plan": "perpetual",
    "features": { "core_export": true, "hosted_ai": true },
    "issued_at": "2026-10-03T00:00:00Z",
    "offline_until": "2026-11-02T00:00:00Z"
  },
  "signature": "base64url-ed25519-signature"
}
```

The signature covers the lease object serialized as UTF-8 JSON with recursively
sorted object keys, compact separators, and no trailing newline. The client
sends the canonical lease bytes as base64url in `X-Lease`, with the signature in
`X-Lease-Signature` and the activation id in `X-Activation-Id`.

The server stores a hash of `license_key`, the device public key and its hash,
activation metadata, entitlements, and revocation state. The public key is
needed to verify device proofs and is not a secret.

### Refresh or revoke an activation

- `POST /v1/activations/{activation_id}/refresh`
- `DELETE /v1/activations/{activation_id}`

Refresh returns a newly signed lease. Deactivation is idempotent. A revoked
activation cannot receive another lease until the server explicitly allows it.
Refresh, deactivation, and hosted AI requests include a device signature over a
canonical action/request id/payload hash, proving possession of the key held in
the OS keychain.

### Hosted AI draft

`POST /v1/ai/draft`

Authenticated with the current activation and lease. The request contains
`locale`, `units`, `norm`, calculated `statistics`, and user-entered `notes`,
plus a request id and a device signature over the canonical payload. It does
not contain raw `.sp3` bytes, filesystem paths, filenames, project names,
engineer names, or the user’s OpenAI key.

The server owns the provider key, allowlists models, rate-limits by activation,
and returns the same five editable fields the current UI already expects:
`summary`, `methodology`, `observations`, `recommendations`, and `conclusion`.

### Consent-based diagnostics

`POST /v1/telemetry/batch`

The client sends events only after explicit opt-in. The server validates an
allowlist before forwarding to PostHog. Events contain app version, platform,
coarse timings/counts, and an anonymous install id. The current allowlist is
`app_started`, `report_generated`, `report_failed`, `license_validated`, and
`app_crashed`. They must not contain project names, engineer names, filenames,
paths, report text, spectra, notes, or raw exception messages.
The PostHog project key and host are server-only configuration (`POSTHOG_API_KEY`
and `POSTHOG_HOST`); the desktop app never accepts or stores them.

## Server data model (SQLite)

Persisted in `REPORT_DB_PATH` with numbered migrations in
`server/store_migrate.go` (schema version **4** on the current integrate tip):

- `customers` (+ `phone_verified_at`), `webauthn_credentials`, `webauthn_challenges`
- `magic_links`, `customer_sessions`, `phone_challenges`, `admin_sessions`
- `licenses`: key hash, plan/status/features, max devices, optional
  `customer_id` / `order_id`, `delivery_ciphertext`
- `activations`: license id, device public key, platform, last seen, revoked
- `orders`, `payment_attempts` (integer rials; authority/payment ref)
- `download_records`, `idempotency`, `delivery_outbox`

Hosted AI usage and telemetry forwarding may also be recorded by handlers; they
must never include report contents, paths, or project identifiers.

The store uses WAL, foreign keys, a busy timeout, a single writer connection,
and offsite backups of the DB plus signing/delivery keys. Postgres is only a
later scale option after measured need for multiple writers or instances. Set
`REPORT_ALLOW_DEV_SEED=1` only for local development. Domestic payment gateways
are redirect adapters: the callback is accepted only after server-to-server
amount and authority verification (`ZARINPAL_MERCHANT_ID` selects ZarinPal).

## Desktop rollout

1. The Rust layer generates and stores a device key in the OS keychain.
2. Rust verifies the signed lease before exposing entitlement status.
3. The signed lease is persisted in keychain-backed storage and treated as
   untrusted until verified.
4. The License panel provides activate, refresh, deactivate, and status actions.
5. Hosted AI and telemetry use the control-plane contracts.
6. The offline draft and local report export remain available without a network.
