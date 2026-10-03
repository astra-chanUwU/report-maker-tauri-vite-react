# Report Maker Go service

This directory contains the Go modular service described in [`docs/go-architecture.md`](../docs/go-architecture.md). It serves the marketing and checkout pages and the JSON control-plane API used by the Tauri desktop app.

## Run locally (development)

```bash
cd server
REPORT_ENV=development REPORT_ALLOW_DEV_SEED=1 REPORT_ALLOW_DEMO_PAYMENTS=1 go run ./cmd/controlplane
```

Development mode is enabled by `REPORT_ENV=development|dev|local` or `REPORT_ALLOW_DEV_SEED=1`.
Without those, startup is **fail-closed production** and rejects missing keys/providers.

The development seed provisions `RM-TEST-1234-KEY0`. Demo payments require the dedicated
flag `REPORT_ALLOW_DEMO_PAYMENTS=1` (development only). A signing key and license-delivery
key are generated per process in development; production must set persistent values.

## Environment variable matrix (C06)

| Variable | Development | Production |
| --- | --- | --- |
| `REPORT_ENV` | `development` / `dev` / `local` | unset or `production` (fail closed) |
| `REPORT_ALLOW_DEV_SEED` | optional `1` (also enables DevMode + seed) | **rejected** |
| `REPORT_ALLOW_DEMO_PAYMENTS` | `1` to enable `DemoGateway` | **rejected** |
| `REPORT_SIGNING_PRIVATE_KEY` | optional (ephemeral if unset) | **required** base64url 32-byte seed |
| `REPORT_SIGNING_KEY_ID` | default `lease-dev-1` | **required** |
| `REPORT_LICENSE_DELIVERY_KEY` | optional (ephemeral if unset) | **required** base64url 32-byte AES key |
| `REPORT_DB_PATH` | default `report-maker.db` | **required** persistent file (not `:memory:`) |
| `PUBLIC_BASE_URL` | default `http://localhost:8080` | **required** `https://…` (enables Secure cookies) |
| `ZARINPAL_MERCHANT_ID` | optional if demo payments enabled | **required** |
| `ZARINPAL_BASE_URL` | optional API/test base | optional |
| `ZARINPAL_TIMEOUT_MS` | default `8000` | default `8000` |
| `REPORT_EMAIL_PROVIDER` | default local → `LocalOutbox` | **required** `http` / `transactional` |
| `REPORT_EMAIL_API_URL` / `REPORT_EMAIL_API_KEY` | optional | **required** with http provider |
| `REPORT_SMS_PROVIDER` | default fake → `FakeSMS` | **required** `http` / `kavenegar` |
| `REPORT_SMS_API_URL` / `REPORT_SMS_API_KEY` | optional | **required** with http provider |
| `REPORT_ADMIN_PASSWORD` | optional | optional (enables `/admin`) |
| `HTTP_ADDR` | default `:8080` | default `:8080` |

Other useful variables:

- `REPORT_PERPETUAL_PRICE_RIALS` — server-side perpetual plan price (catalog-owned)
- `REPORT_EMAIL_FROM` / `REPORT_EMAIL_FROM_NAME` — sender identity
- `REPORT_EMAIL_TIMEOUT_MS` / `REPORT_EMAIL_MAX_RETRIES`
- `REPORT_SMS_SENDER` / `REPORT_SMS_TIMEOUT_MS` / `REPORT_SMS_MAX_RETRIES`
- `REPORT_ARTIFACT_ROOT` / `REPORT_RELEASE_MANIFEST`
- `REPORT_WEB_AUTHN_RP_ID` / `REPORT_WEB_AUTHN_ORIGINS` / `REPORT_WEB_AUTHN_RP_NAME`

### Fail-closed production rules

- No silent `DemoGateway`, `LocalOutbox`, or `FakeSMS`.
- Startup fails when signing key, delivery key, DB path, HTTPS public URL, ZarinPal, or email/SMS providers are missing.
- Provider HTTP clients use bounded timeouts, limited response bodies, and redacted errors.
- Browser responses set CSP, `X-Frame-Options`, request body limits (1 MiB), and Secure cookies when `PUBLIC_BASE_URL` is HTTPS.
- HTMX is served from local `/static/htmx.min.js` (embedded under `server/static/`), not unpkg CDN.

### Email and SMS providers

Customer email covers purchase receipts, license access, magic links, and download
access. SMS covers phone verification/recovery. Both go through interfaces in
`providers.go` (`EmailSender`, `SMSSender`).

Domain authentication before production email:

1. Publish SPF for the sending domain (or subdomain such as `mail.example.ir`).
2. Add the provider’s DKIM keys and verify them in the provider console.
3. Publish DMARC (`p=none` while warming up, tighten later).
4. Use `REPORT_EMAIL_FROM` only on that verified domain.
5. Confirm magic-link links use the production `PUBLIC_BASE_URL` HTTPS origin.

The Go service uses SQLite first. `REPORT_DB_PATH` selects the persistent file;
the store enables WAL, foreign keys, a five-second busy timeout, and a single
writer connection. Back up the database and signing configuration off the VPS.
