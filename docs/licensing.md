# Licensing

## Model

- **Perpetual license key, offline-capable.** Buy once, use forever for the current major.
- The Go control plane owns activation, device count, revocation, and hosted entitlements. The core report pipeline remains usable offline during the signed lease period.
- Optional subscription later only for hosted extras (AI credits, template packs, priority updates). The core report pipeline never requires a subscription.
- Dev builds (`npm run dev`, `vite dev`, `localhost` + no Tauri) are never hard-locked.

## Localhost-only format check (not production licensing)

The desktop still contains a local `RM-XXXX-XXXX-XXXX` format/checksum helper used only for localhost plumbing and UI exercises. It is **not** how customer licenses are issued or validated in production.

- Each `X` is `A–Z0–9`; the 12 payload chars satisfy `sum(charValue) mod 36 == 0`.
- Anyone can generate another checksum-valid value (`node scripts/gen-license.mjs`).
- Release builds must use the signed-lease path against the Go service; do not treat this helper as an authority.

Example locally valid keys (format check only):

- `RM-0000-0000-0000`
- values produced by `scripts/gen-license.mjs`

Development seed on the Go service (when `REPORT_ALLOW_DEV_SEED=1`): `RM-TEST-1234-KEY0`.

## Production validation (Go control plane)

Customer licenses are opaque server-issued identifiers. After verified payment the service:

1. Generates a unique license key once (idempotent across callback retries / ZarinPal `101`).
2. Stores a lookup hash plus AES-encrypted delivery ciphertext (`REPORT_LICENSE_DELIVERY_KEY`).
3. Shows a masked key on unauthenticated callback/status pages.
4. Reveals the plaintext key only to the owning signed-in customer (`POST /account/purchases/reveal`).
5. Issues Ed25519 offline leases via `POST /v1/activations` (signing private key never leaves the server).

Desktop behavior:

- Tauri generates a device keypair in the OS keychain.
- Rust verifies the lease signature and device binding before paid/hosted operations.
- Lease refresh (for example every 30 days) applies revocations and device limits when online.
- Report files stay on the user’s machine.

Payment boundary:

- Checkout creates a pending order and redirects to the domestic gateway adapter.
- The callback is accepted only after server-to-server authority and amount verification.
- The gateway never owns license state, activation state, or report data.

## Updates

No `tauri-plugin-updater` yet. The app can check GitHub Releases manually:

`GET https://api.github.com/repos/astra-chanUwU/report-maker-tauri-vite-react/releases/latest`

Settings → License → “Check for updates” compares `tag_name` to the bundled version. CI (`release.yml`) publishes Tauri bundles as a draft GitHub Release on `v*` tags and manual dispatch.

## Implementation order (remaining ops)

1. Keep the Go service on persistent SQLite with WAL and offsite backups.
2. Publish real signed installers into `REPORT_ARTIFACT_ROOT` (fixture artifacts are for tests; see `docs/releases.md`).
3. Provision production `REPORT_SIGNING_PRIVATE_KEY` / `REPORT_LICENSE_DELIVERY_KEY` and matching desktop public key.
4. Keep Tauri updater signing separate from the lease signing key.
5. Do not introduce Postgres until multiple writers or multiple service instances are a measured need.
