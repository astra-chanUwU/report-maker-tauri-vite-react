# Licensing (S09 decision)

## Model

- **Perpetual license key, offline-validated.** Buy once, use forever for the current major.
- Optional subscription later only for hosted extras (AI credits, template packs, priority updates). The core report pipeline never requires a subscription.
- Dev builds (`npm run dev`, `vite dev`) are never hard-locked.

## Key format (v1, placeholder checksum)

`RM-XXXX-XXXX-XXXX` where each `X` is `A–Z0–9` and the 12 payload chars satisfy
`sum(charValue) mod 36 == 0` (`0–9` → 0–9, `A–Z` → 10–35).

This is intentionally simple: it proves the plumbing (Rust validator +
TS mirror + persisted status + grace period) without pretending to be
unbreakable. Before selling keys, replace the checksum with HMAC-SHA256
(Rust `hmac` crate, server-side issuance, key = payload + tag) and bump to v2.

## Validation

- Rust: `src-tauri/src/license.rs` → `validate_license` Tauri command.
- Web/TS mirror: `src/lib/license.ts` (same checksum rule).
- Stored via `tauri-plugin-store` when available, `localStorage` fallback in
  `vite dev`. Record includes key, validated-at timestamp, dev flag.
- Offline grace: a previously validated key stays valid for 30 days without
  re-check.

## Updates

No `tauri-plugin-updater` (avoids signing infrastructure for now). The app
checks GitHub Releases manually:

`GET https://api.github.com/repos/astra-chanUwU/report-maker-tauri-vite-react/releases/latest`

Settings → License → “Check for updates” compares `tag_name` to the bundled
version and links to the release page. Zero network calls unless the user
clicks.
