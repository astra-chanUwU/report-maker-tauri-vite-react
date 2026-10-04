# Report Maker Go service

This directory contains the Go modular service described in [`docs/go-architecture.md`](../docs/go-architecture.md). It serves the marketing and checkout pages and the JSON control-plane API used by the Tauri desktop app.

## HTTP surface (integrate tip)

| Area | Paths |
| --- | --- |
| Health | `GET /healthz`, `GET /readyz` |
| Marketing / checkout | `GET /`, `/pricing`, `/download`; `POST /checkout/start`; `GET /checkout/status` |
| Payments | `GET /payments/{provider}/redirect`, `GET /payments/{provider}/callback` |
| Customer auth | `/login`, `/auth/*`, `/account`, `/account/purchases`, `/account/purchases/reveal` |
| Downloads | `/account/downloads`, `/account/downloads/renew`, `/downloads/{artifact_id}`, `/downloads/link/{token}` |
| Admin (minimal) | `/admin/login`, `/admin`, `/admin/logout` — full support console is **C09** |
| Desktop JSON | `/v1/activations`, `/v1/activations/{id}/refresh`, `/v1/activations/{id}`, `/v1/ai/draft`, `/v1/telemetry/batch` |

Catalog price: perpetual plan defaults to **1_000_000 rials** (`REPORT_PERPETUAL_PRICE_RIALS`).
Schema version: **4** (`delivery_outbox` included). Details: [`docs/go-architecture.md`](../docs/go-architecture.md).

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

Local defaults in development (no secrets required): `LocalOutbox` and `FakeSMS`.

Extended provider selection (set only on the host; never commit values):

| Variable | Purpose |
| --- | --- |
| `REPORT_EMAIL_PROVIDER` | `local` (dev default), `kavenegar` / `http`, `smtp`, `outbox`, or `noop` |
| `REPORT_EMAIL_API_URL` | Transactional HTTP API endpoint (Iranian provider or compatible) |
| `REPORT_EMAIL_API_KEY` | Provider API token (secret) |
| `REPORT_EMAIL_FROM` | From address on an authenticated sending domain |
| `REPORT_EMAIL_FROM_NAME` | Display name (default `Report Maker`) |
| `REPORT_EMAIL_TIMEOUT_MS` | HTTP timeout (default `8000`) |
| `REPORT_EMAIL_MAX_RETRIES` | Retries on transient failures (default `2`) |
| `REPORT_SMTP_HOST` / `REPORT_SMTP_PORT` | Generic SMTP relay fallback |
| `REPORT_SMTP_USER` / `REPORT_SMTP_PASSWORD` | SMTP credentials (secrets) |
| `REPORT_SMS_PROVIDER` | `fake` (dev default), `kavenegar`, `http`, or `noop` |
| `REPORT_SMS_API_KEY` | Kavenegar or HTTP API token (secret) |
| `REPORT_SMS_SENDER` | Provider sender line / number |
| `REPORT_SMS_TEMPLATE` | Optional OTP template name |
| `REPORT_SMS_API_URL` | Custom SMS HTTP endpoint |
| `REPORT_SMS_TIMEOUT_MS` | HTTP timeout (default `8000`) |
| `REPORT_SMS_MAX_RETRIES` | Retries on transient failures (default `2`) |
| `REPORT_OUTBOX_MAX_ATTEMPTS` | SQLite outbox retry cap (default `10`) |


Domain authentication before production email:

1. Publish SPF for the sending domain (or subdomain such as `mail.example.ir`).
2. Add the provider’s DKIM keys and verify them in the provider console.
3. Publish DMARC (`p=none` while warming up, tighten later).
4. Use `REPORT_EMAIL_FROM` only on that verified domain.
5. Confirm magic-link links use the production `PUBLIC_BASE_URL` HTTPS origin.

Provider adapters use bounded timeouts, limited response bodies, idempotency keys
on sends, and redacted logs (no API keys, magic-link tokens, or SMS codes). A
SQLite `delivery_outbox` table records pending deliveries and retries them after
process restart. See [`docs/providers.md`](../docs/providers.md) for SPF/DKIM/DMARC,
SMS templates, and outbox behaviour. A provider outage after payment verification
must not undo a paid order; support can still resolve the order by ID.

The `PaymentGateway` interface in `payment.go` is the boundary for a domestic redirect processor such as ZarinPal/ZarinPay. `DemoGateway` is only a local development flow (`REPORT_ALLOW_DEMO_PAYMENTS=1`) that exercises pending order, redirect, callback, server-side verification, and idempotent paid state. Production requires `ZARINPAL_MERCHANT_ID` and compares the verified amount to the stored order amount before provisioning a license.

The Go service uses SQLite first. `REPORT_DB_PATH` selects the persistent file;
the store enables WAL, foreign keys, a five-second busy timeout, and a single
writer connection. Back up the database and signing configuration off the VPS.
Postgres remains a future option if deployment grows beyond one service process.

The service intentionally keeps report files and `.sp3` data on the desktop.
Hosted AI and telemetry endpoints remain contract-compatible with the desktop
client.

## Release artifacts

```bash
cd server && go run ./cmd/publish-release
REPORT_ENV=development REPORT_ARTIFACT_ROOT=testdata/artifacts REPORT_ALLOW_DEV_SEED=1 REPORT_ALLOW_DEMO_PAYMENTS=1 go run ./cmd/controlplane
```

See [`docs/releases.md`](../docs/releases.md).

## Production deployment

[`docs/deployment.md`](../docs/deployment.md). Backup scripts:
`server/scripts/backup-sqlite.*`, `verify-sqlite-restore.*`.
