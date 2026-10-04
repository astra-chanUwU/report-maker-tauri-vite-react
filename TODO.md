# Current work and verification backlog

This file describes the current repository. It is not an agent handoff and does
not describe old branches. The desktop application and the Go service are both
on `main`.

## Already present on main

- React/TypeScript/Tauri desktop workspace for CSV and `.sp3` imports, charts,
  report editing, AI draft fields, and DOCX export.
- Rust device-key storage and signed Ed25519 lease verification.
- Go service with SQLite migrations, licensing, activation, refresh, revoke,
  hosted-AI and consented-telemetry contracts.
- Customer identity with passkeys, magic-link/passwordless sign-in, optional
  password fallback, Iranian phone verification, and separate admin sessions.
- ZarinPal-compatible redirect/request/callback/verify payment boundary and a
  development-only demo gateway.
- License provisioning after verified payment, masked disclosure, repeatable
  downloads, artifact checksums, and a persistent email/SMS delivery outbox.
- Server-rendered marketing, pricing, checkout, account, download, and support
  pages using Go templates and HTMX.
- SQLite backup, restore-verification, release-publication, and graceful
  shutdown scripts.

## Fix next

### 1. Make release fixture verification deterministic

`go test ./...` currently fails in
`TestFixtureArtifactsMatchEmbeddedManifest`: the committed text fixtures and
the manifest were hashed with different line endings. Recalculate the manifest
from the exact committed bytes, or replace the text fixtures with real binary
test artifacts. Do not describe fixtures as production installers.

### 2. Refresh documentation after the checksum fix

Keep README and the architecture documents aligned with the code. When a route,
schema migration, provider, or release format changes, update the relevant
document in the same change.

## Manual checks before production

These cannot be claimed from unit tests alone:

- register and use a passkey in a real browser on the final HTTPS domain;
- run a ZarinPal sandbox/manual request, redirect, callback, verify, and retry;
- send real receipt, magic-link, and phone-verification messages through the
  selected Iranian providers;
- deploy behind HTTPS on the chosen VPS and run a clean SQLite restore drill;
- build, sign, publish, download, and checksum real Tauri installers;
- verify desktop activation, lease refresh, revoke, hosted AI, and consented
  telemetry against the deployed service.

## Desktop follow-up

The desktop-specific report and DOCX backlog is kept in [TODO.next.md](TODO.next.md).
It should be worked after the import/export path is exercised with real sample
data, not treated as server deployment work.

## Verification commands

```text
cd server && go test ./...
cd server && go vet ./...
npm run typecheck
npm test -- --run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml -q
git diff --check
```

Report automated checks, HTTP checks, browser/device checks, live-provider
checks, and unavailable checks separately.
