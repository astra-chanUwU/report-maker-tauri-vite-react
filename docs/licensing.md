# Licensing

## Product model

The planned product is a perpetual desktop license. The core report pipeline
remains usable offline during the signed lease window. Hosted AI and other
server-backed extras may have separate limits later, but report files and DOCX
generation stay on the user's machine.

Development builds may use the local checksum helper for UI exercises. That
helper is not a production authority: anyone can generate another checksum-valid
value with `node scripts/gen-license.mjs`.

## Production lifecycle

After a verified domestic payment, the Go service:

1. creates one license idempotently across callback retries;
2. stores a lookup hash and recoverable delivery ciphertext;
3. shows only a masked key on unauthenticated status pages;
4. reveals the plaintext key only to the owning customer session;
5. issues an Ed25519-signed offline lease when the desktop activates.

The desktop generates a device keypair in the OS keychain. Rust verifies the
lease signature and device binding before exposing entitlement state to React.
Refreshing the lease brings revocations and device limits up to date. A user can
download the purchased installer repeatedly; download links may expire and be
renewed after authentication.

## Payment boundary

Checkout creates a pending order and redirects to the configured domestic
processor. The callback is accepted only after server-to-server authority and
amount verification. The gateway does not own license state, activation state,
or report data.

## Updates

There is no Tauri updater plugin yet. The desktop can check the latest GitHub
Release metadata, while the Go service provides the customer download page.
The release workflow builds draft bundles on version tags, but test fixture files
in the repository are not signed production installers.

Keep Tauri updater signing, if added later, separate from the Ed25519 lease key
and the AES license-delivery key.

## Operational rules

- Keep SQLite persistent with WAL and tested backups.
- Keep signing and delivery keys outside the repository and back them up
  separately from the database.
- Do not introduce Postgres until measured need for multiple writers or service
  instances exists.
- Treat browser, provider, VPS, and desktop interoperability checks as separate
  evidence from automated tests.
