# Licensing (S09 decision)

## Model

- **Perpetual license key, offline-validated.** Buy once, use forever for the current major.
- Optional subscription later only for hosted extras (AI credits, template packs, priority updates). The core report pipeline never requires a subscription.
- Dev builds (`npm run dev`, `vite dev`, `localhost` + no Tauri) are never hard-locked.

## Key format (v1, placeholder checksum)

`RM-XXXX-XXXX-XXXX` where each `X` is `A–Z0–9` and the 12 payload chars satisfy
`sum(charValue) mod 36 == 0` (`0–9` → 0–9, `A–Z` → 10–35).

This is intentionally simple: it proves the plumbing (Rust validator +
TS mirror + persisted status + grace period) without pretending to be
unbreakable. Before selling keys, replace the checksum with HMAC-SHA256
(Rust `hmac` crate, server-side issuance, key = payload + tag) and bump to v2.

Example valid keys (checksum 0):

- `RM-0000-0000-0000` (all zeros)
- `RM-AAAA-AAAA-AAAZ` — craft by brute force; `scripts/gen-license.mjs` does this.

```bash
node scripts/gen-license.mjs          # prints a valid v1 key
node scripts/gen-license.mjs RM-TEST-1234-XXXX  # brute-forces last 4 chars
```

## Validation

- Rust: `src-tauri/src/license.rs` → `validate_license` Tauri command.
- Web/TS mirror: `src/lib/license.ts` (`checkKeyFormat`) — same checksum rule; used in `vite dev` and as fallback when `invoke` unavailable.
- Stored via `tauri-plugin-store` when available, `localStorage` fallback in
  `vite dev`. Record includes key, validated-at timestamp, dev flag.
- Offline grace: a previously validated key stays valid for 30 days without
  re-check. After 30 days the stored record reports `Grace period expired — re-validate online.` but never blocks export; dev flag always bypasses.
- Dev bypass: `isDev()` (localhost without Tauri) returns a record with `dev: true` even without a key; production Tauri builds require a key only if you add a gate (currently no hard lock).

## Updates

No `tauri-plugin-updater` (avoids signing infrastructure for now). The app
checks GitHub Releases manually:

`GET https://api.github.com/repos/astra-chanUwU/report-maker-tauri-vite-react/releases/latest`

Settings → License → “Check for updates” compares `tag_name` to the bundled
version and links to the release page. Zero network calls unless the user
clicks. CI (`release.yml`) publishes the Tauri bundles as a draft GitHub Release on `v*` tags and on manual dispatch.

## Selling checklist (before v2)

1. Add Rust `hmac` + `sha2`, issue HMAC-SHA256 tags server-side, embed `payload.tag`.
2. Rotate to `RM-...` v2, keep v1 validator for grace.
3. Add server revocation list + periodic online check (retain 30-day offline grace).
4. Sign Tauri updater keys (`tauri signer generate`) and switch to `tauri-plugin-updater` for auto-updates.
