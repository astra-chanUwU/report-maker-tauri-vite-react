# Licensing

## Model

- **Perpetual license key, offline-capable.** Buy once, use forever for the current major.
- The server controls activation, device count, revocation, and hosted entitlements. The core report pipeline remains usable offline during the signed lease period.
- Optional subscription later only for hosted extras (AI credits, template packs, priority updates). The core report pipeline never requires a subscription.
- Dev builds (`npm run dev`, `vite dev`, `localhost` + no Tauri) are never hard-locked.

## Current development validator (v1, placeholder checksum)

`RM-XXXX-XXXX-XXXX` where each `X` is `A–Z0–9` and the 12 payload chars satisfy
`sum(charValue) mod 36 == 0` (`0–9` → 0–9, `A–Z` → 10–35).

This is intentionally simple: it proves the plumbing (Rust validator +
TS mirror + persisted status + grace period) without pretending to be
production licensing. It must not be used to issue customer keys because
anyone can generate another checksum-valid value.

Example valid keys (checksum 0):

- `RM-0000-0000-0000` (all zeros)
- `RM-AAAA-AAAA-AAAZ` — craft by brute force; `scripts/gen-license.mjs` does this.

```bash
node scripts/gen-license.mjs          # prints a valid v1 key
node scripts/gen-license.mjs RM-TEST-1234-XXXX  # brute-forces last 4 chars
```

## Production validation design

The production app will use a Go HTTPS service that also owns the marketing
site, checkout, and domestic payment callbacks. The license key is
an opaque server-issued identifier; the desktop app does not decide whether a
key is genuine by itself.

- The Tauri backend generates a device keypair and stores the private key in
  the OS keychain.
- `POST /v1/activations` exchanges a license key and device public key for a
  signed offline lease.
- The lease is signed with Ed25519. The private signing key exists only on the
  server; the app contains only the public verification key.
- The Rust side verifies the lease before paid operations. The UI only displays
  the result and never becomes the security boundary.
- A perpetual license has no product expiry, but its lease is refreshed on a
  schedule (for example, every 30 days) so revocations and device limits take
  effect when the app reconnects.
- The server stores a hash of the license key, the device public key needed for
  proof verification, activation metadata, revocation state, and entitlements.
  Report files stay on the user’s machine.
- A purchase creates a pending order, redirects the customer to the selected
  domestic payment gateway, and accepts the license only after the Go service
  verifies the gateway authority and exact stored amount server-to-server.
- The payment gateway is an adapter behind the Go service. It never owns
  license state, activation state, or report data.

- The current Rust validator and TypeScript mirror are localhost-only
  development compatibility code. Release builds use the signed lease path.
- Dev bypass: `isDev()` (localhost without Tauri) remains available and is
  never hard-locked.

## Updates

No `tauri-plugin-updater` (avoids signing infrastructure for now). The app
checks GitHub Releases manually:

`GET https://api.github.com/repos/astra-chanUwU/report-maker-tauri-vite-react/releases/latest`

Settings → License → “Check for updates” compares `tag_name` to the bundled
version and links to the release page. Zero network calls unless the user
clicks. CI (`release.yml`) publishes the Tauri bundles as a draft GitHub Release on `v*` tags and on manual dispatch.

## Implementation order

1. Keep the Go service on a persistent SQLite database with WAL and offsite
   backups; add Postgres only if deployment later needs multiple instances or
   high-concurrency workers.
2. Add the selected domestic gateway adapter and license delivery workflow.
3. Provision the Go service with a persistent `REPORT_SIGNING_PRIVATE_KEY`,
   allowlisted AI model, and provider key.
4. Build release binaries with `REPORT_MAKER_LICENSE_PUBLIC_KEY` set to the
   matching base64url Ed25519 public key.
5. Keep Tauri updater signing separate from the license signing key.
