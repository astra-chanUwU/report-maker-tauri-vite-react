# C10 — Complete the marketing and customer UX

## Branch

`feat/c10-marketing-ux` from `origin/integrate/control-plane`

## Commit

`b73189c1205be8a98aae5ec208a446924949b8f5`

## Pages added

| Route | Purpose |
|-------|---------|
| `/privacy` | Privacy policy |
| `/refund` | Refund policy |
| `/support` | Support guidance |
| `/offline-use` | Offline workflow explanation |
| `/install` | Install and SHA-256 checksum guidance |
| `/faq` | FAQ |
| `/download` | Pre-purchase download guidance (`download-info` template) |

Enhanced journey pages: `/`, `/pricing`, `/login`, `/account`, `/account/purchases`, `/account/downloads`, payment callback, `/checkout/status`.

## Config

- `REPORT_SITE_LANG` — default `en`; set `fa` for Persian nav/footer copy
- `REPORT_SITE_DIR` — `ltr` or `rtl` (defaults from lang)

## Validation

```text
cd server && go test ./... -count=1
cd server && go vet ./...
```

Result: all tests pass; vet clean.

## Known limitations

Browser passkey/payment walkthrough not recorded (automated HTTP tests only).
