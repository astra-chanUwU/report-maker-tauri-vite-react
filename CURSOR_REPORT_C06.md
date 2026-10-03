# CURSOR_REPORT_C06 — Production configuration fail closed

## 1. Slice and outcome

Implemented C06 on `feat/c06-prod-fail-closed` from `origin/integrate/control-plane`.

Production configuration now fails closed: missing signing/delivery keys, DB path,
HTTPS public URL, ZarinPal, or real email/SMS providers prevent startup. Demo
payments require dedicated `REPORT_ALLOW_DEMO_PAYMENTS=1` in development only.
Local HTMX, CSP, request-size limits, and Secure cookies on HTTPS are in place.

## 2. Files changed

**Backend**

- `server/config.go` (new) — `ConfigFromEnv`, `ValidateConfig`, env matrix, cookie Secure helper
- `server/security.go` (new) — CSP/security headers, 1 MiB request body limit
- `server/static.go` (new) — embed/serve `server/static/*`
- `server/static/htmx.min.js` (new) — HTMX 2.0.4 local asset
- `server/app.go` — DevMode/AllowDemoPayments, fail-closed `NewApp`, static routes, security handler
- `server/providers.go` — no silent LocalOutbox/FakeSMS outside development
- `server/payment.go` — ZarinPal timeout, bounded/redacted errors
- `server/csrf.go`, `server/auth.go`, `server/admin.go` — Secure cookies via `cookieSecure()`
- `server/templates.go` — `/static/htmx.min.js` instead of unpkg CDN

**Tests / docs**

- `server/config_test.go` (new)
- `server/README.md`, `TODO.md`, `CURSOR_REPORT_C06.md`

## 3. Architecture decisions

- Fail closed by default: unset `REPORT_ENV` is production unless `REPORT_ENV=development|dev|local` or `REPORT_ALLOW_DEV_SEED=1`.
- Dedicated `REPORT_ALLOW_DEMO_PAYMENTS` rather than overloading seed flag.
- Unit tests that inject fakes are detected via `looksLikeTestConfig` so suites stay credential-free.
- Flat `controlplane` package preserved.

## 4. Security/privacy review

- Production rejects DemoGateway, LocalOutbox, FakeSMS, and ephemeral keys.
- Provider errors redact bearer tokens, license keys, and long opaque secrets.
- CSP + frame denial + nosniff on all responses; MaxBytesReader 1 MiB.
- Secure cookie flag tied to HTTPS `PUBLIC_BASE_URL`.
- No CDN dependency for HTMX in production pages.

## 5. Validation evidence

```text
cd server
set GOPROXY=https://goproxy.io,https://goproxy.cn,direct
set GOSUMDB=off
"C:\Program Files\Go\bin\go.exe" test ./... -count=1
"C:\Program Files\Go\bin\go.exe" vet ./...
```

Results: `ok reportmaker/controlplane`; vet clean.

Automated coverage includes production reject, development without credentials,
demo-flag gating, CSP/local HTMX, Secure cookie helper, and redaction.

Browser/device and live-provider checks: not run in this slice.

## 6. Known limitations

- Full Iranian provider adapters remain C08; production requires HTTP-shaped credentials.
- Admin delivery search console remains C09; admin home notes secret-free support posture.
- Real HTTPS reverse-proxy deployment remains C11.

## 7. Next slice

C07 (release artifacts) or C09 (admin console) depending on integration order; both depend on C04/C06 grounding.

## 8. Git state

- Branch: `feat/c06-prod-fail-closed`
- Base: `origin/integrate/control-plane` @ `5772302`
- No secrets committed
