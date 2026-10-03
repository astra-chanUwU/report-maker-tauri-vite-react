# S01 — Customer identity for production use

## 1. Slice and outcome

Implemented production-oriented customer identity hardening for the Go control plane:

- Browser passkey client (inline JS on login/account pages; no npm/SPA)
- CSRF double-submit cookie on all mutating browser forms and cookie-authenticated JSON POSTs
- In-memory rate limits (magic link, password login, passkey, admin login, phone request)
- Session rotation on magic-link consume, password login, and passkey login finish
- `EmailSender` / `LocalOutbox` for magic links (no token in production responses)
- Phone verification with `SMSSender` / `FakeSMS` and `phone_verified_at` column
- Separate admin auth (`report_maker_admin_session`, `REPORT_ADMIN_PASSWORD`)
- Protocol tests for CSRF, rate limits, email outbox, session rotation, admin boundary, phone verify

**Remaining:** Real browser passkey registration and discoverable login on the configured RP ID/origin must be verified manually. Go toolchain was not present at session start; install attempted via winget.

## 2. Files changed

### Backend (`server/`)
- `auth.go` — CSRF, rate limits, session rotation, email delivery, passkey counter comment
- `app.go` — Config extensions, email/SMS/rate limit wiring, checkout CSRF
- `store.go` — `phone_verified_at`, `phone_challenges`, `admin_sessions`, session delete helpers
- `templates.go` — Login/account/admin pages with passkey JS, CSRF forms, nav sign-in link
- `csrf.go` — new
- `ratelimit.go` — new
- `providers.go` — new (`EmailSender`, `LocalOutbox`, `SMSSender`, `FakeSMS`)
- `admin.go` — new
- `phone.go` — new

### Tests
- `auth_test.go` — new protocol tests
- `app_test.go` — CSRF on magic-link, password, checkout flows

### Docs
- `TODO.md` — S01 progress notes
- `CURSOR_REPORT.md` — this file

## 3. Architecture decisions

- Kept flat `controlplane` package layout; no `internal/` reorganization.
- CSRF uses synchronizer cookie (`report_maker_csrf`, non-HttpOnly) plus form field / `X-CSRF-Token` header so inline passkey JS can authenticate POSTs without a bundler.
- Session rotation deletes all prior customer sessions on login to limit session fixation.
- Email/SMS behind interfaces with in-memory defaults so local dev and tests work without providers.
- Admin sessions stored in SQLite (`admin_sessions`) with a separate cookie name; customer cookies never grant admin access.

## 4. Security/privacy review

| Area | Implementation |
|------|----------------|
| CSRF | Required on checkout, magic-link, password login, logout, admin login, passkey begin/finish, phone endpoints |
| Rate limits | Per-IP in-memory: magic link 5/15m, password 10/15m, passkey 20/15m, admin 10/15m, phone 5/15m |
| Magic link tokens | Sent via `EmailSender` only; `X-Dev-Magic-Link` header only when `AllowDevSeed` |
| Session rotation | All customer sessions revoked on successful login |
| Admin boundary | Separate cookie + store table; `/admin` rejects customer session |
| WebAuthn counters | `TouchWebAuthnCredential` persists updated credential JSON after login finish |
| Phone codes | Hashed in `phone_challenges`; 6-digit code via SMS interface |

## 5. Validation evidence

### Automated (Go)
```text
cd server && go test ./... -count=1
# ok  reportmaker/controlplane  1.838s

cd server && go vet ./...
# exit 0
```
**Status:** Pass on Go 1.27.0 windows/amd64.

### HTTP / protocol tests (auth_test.go, app_test.go)
All listed protocol tests pass (CSRF, rate limit, session rotation, admin boundary, phone verify, magic-link/password, activation, payment).

### Browser / device
- **Not verified** — passkey registration and discoverable login require manual browser check on target domain/origin.

### Live providers
- **Not verified** — no production email/SMS credentials configured.

## 6. Known limitations

- Real WebAuthn ceremony not automated in tests (browser-only).
- In-memory rate limiter resets on process restart; not suitable for multi-instance without shared store.
- Admin password is a single shared secret (`REPORT_ADMIN_PASSWORD`); no MFA.
- Phone verification SMS uses `FakeSMS` by default.

## 7. Next slice

**S02 — Provision a license after verified payment**

Depends on S01. Generate unique license key after verified ZarinPal payment; idempotent provisioning; associate license with customer/order. Acceptance: demo gateway and mocked ZarinPal both prove one paid order → one license.

## 8. Git state

- Branch: `main`
- Commit: S01 customer identity slice (see git log)
- No secrets committed
- Remaining: manual browser passkey verification; S02+ not started
