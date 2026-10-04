# Desktop control-plane contract

The control plane is the Go service used for licensing, optional hosted AI, and
consented diagnostics. It is not the report database and it does not receive
`.sp3` files during normal report generation. The desktop remains useful when
offline for the lifetime of its verified lease.

## Boundaries

- Rust is the desktop security boundary. React displays status and invokes Rust
  commands; it does not verify leases or hold long-lived server secrets.
- The service owns activation, device limits, revocation, plan features, and
  payment-derived entitlements.
- The service signs short-lived offline leases with Ed25519. The private key
  never ships in the app; the desktop contains only the verification key.
- Report files, spectra, paths, project names, engineer names, and report text
  remain local unless a future explicit feature changes that contract.

## Activation API

All `/v1/*` endpoints use JSON. Errors have this shape:

```json
{"error":{"code":"machine_readable_code","message":"Safe user-facing text"}}
```

### `POST /v1/activations`

Request fields include `license_key`, `device_public_key`, `app_version`, and
`platform`. A successful response contains an activation id, a lease object, and
an Ed25519 signature. The lease includes the license, device key, plan/features,
issue time, and `offline_until` time.

The signature covers canonical UTF-8 JSON: recursively sorted object keys,
compact separators, and no trailing newline. The desktop sends the canonical
lease bytes as `X-Lease`, its signature as `X-Lease-Signature`, and the id as
`X-Activation-Id`.

The service stores a hash of the license key, the device public key, activation
metadata, entitlements, and revocation state. The public key is not secret.

### Refresh and revoke

```text
POST   /v1/activations/{id}/refresh
DELETE /v1/activations/{id}
```

Both operations require a device signature proving possession of the key held in
the OS keychain. Refresh returns a newly signed lease. Revoke is idempotent and
prevents further refresh until the service allows a new activation.

## Hosted AI

`POST /v1/ai/draft` requires a valid lease and device proof. The current request
contains locale, units, norm, calculated statistics, notes, and a request id.
The current server implementation returns a deterministic contract response;
provider-backed generation is still a later implementation step. The response
contains the five editable fields used by the desktop editor:
`summary`, `methodology`, `observations`, `recommendations`, and `conclusion`.

The service must not receive raw `.sp3` bytes, filesystem paths, filenames,
project names, engineer names, or the user's provider key. If the request cannot
be served, the desktop uses its deterministic offline draft.

## Consent-based telemetry

`POST /v1/telemetry/batch` accepts events only when `consent` is true. The
service validates the consent flag and rejects fields containing project names,
engineer names, filenames, paths, report text, spectra, notes, or raw errors.
The desktop sends only coarse counts/timings, platform, app version, and an
anonymous install id. Telemetry is disabled by default and must never interrupt
the report workflow.

The current service validates and accepts the allowlisted batch. Any later
forwarding or analytics provider must remain behind the same consent and
redaction boundary; provider credentials must never be shipped to the desktop.

## Payment and identity boundary

The website creates a pending order, redirects to the domestic gateway, and
marks the order paid only after server-to-server authority and amount
verification. One verified payment provisions one license idempotently, including
already-verified gateway responses.

Customers provide actual first name, surname, email, and Iranian phone number.
Passkeys are preferred, with magic-link/passwordless sign-in and optional
password fallback. Admin identity is separate from customer identity.

## SQLite model

The current schema version is **5**. It includes customers, WebAuthn
credentials/challenges, sessions, phone challenges, licenses, activations,
orders, payment attempts, downloads, idempotency, delivery outbox rows, admin
audit rows, and support notes. SQLite uses WAL, foreign keys, a busy timeout,
and one writer. Postgres remains a measured future option, not a current
dependency.
