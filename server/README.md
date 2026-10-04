# Report Maker Go service

This directory contains the Go modular monolith described in
[`docs/go-architecture.md`](../docs/go-architecture.md). It serves the public
website, customer account, payment flow, downloads, support administration, and
the JSON control-plane API used by the Tauri desktop app.

## HTTP surface

| Area | Paths |
| --- | --- |
| Health | `GET /healthz`, `GET /readyz` |
| Marketing | `GET /`, `/pricing`, `/download`, `/privacy`, `/refund`, `/support`, `/offline-use`, `/install`, `/faq` |
| Checkout | `POST /checkout/start`, `GET /checkout/status` |
| Payments | `GET /payments/{provider}/redirect`, `GET /payments/{provider}/callback` |
| Customer auth | `/login`, `/auth/*`, `/account`, `/account/purchases` |
| Downloads | `/account/downloads`, `/account/downloads/renew`, `/downloads/{artifact_id}`, `/downloads/link/{token}` |
| Admin support | `/admin/login`, `/admin`, `/admin/orders/{order_id}`, `/admin/activations/{activation_id}/revoke` |
| Desktop JSON | `/v1/activations`, `/v1/activations/{id}/refresh`, `/v1/activations/{id}`, `/v1/ai/draft`, `/v1/telemetry/batch` |

The default perpetual catalog price is **1,000,000 rials** and can be changed
with `REPORT_PERPETUAL_PRICE_RIALS`. The current SQLite schema version is **5**.

## Run locally

```bash
cd server
REPORT_ENV=development \
REPORT_ALLOW_DEV_SEED=1 \
REPORT_ALLOW_DEMO_PAYMENTS=1 \
go run ./cmd/controlplane
```

Development mode uses `http://localhost:8080`, a local SQLite file, an ephemeral
lease key, a local email outbox, fake SMS, and the demo payment gateway. These
substitutes are rejected by production configuration.

## Configuration

| Variable | Development | Production |
| --- | --- | --- |
| `REPORT_ENV` | `development`, `dev`, or `local` | unset or `production` |
| `REPORT_ALLOW_DEV_SEED` | optional `1` | rejected |
| `REPORT_ALLOW_DEMO_PAYMENTS` | optional `1` | rejected |
| `REPORT_SIGNING_PRIVATE_KEY` | optional ephemeral key | required |
| `REPORT_SIGNING_KEY_ID` | default development id | required |
| `REPORT_LICENSE_DELIVERY_KEY` | optional ephemeral key | required |
| `REPORT_DB_PATH` | default local file | required persistent file |
| `PUBLIC_BASE_URL` | default `http://localhost:8080` | required `https://…` |
| `ZARINPAL_MERCHANT_ID` | optional with demo gateway | required |
| `REPORT_EMAIL_PROVIDER` | local outbox | real HTTP/transactional provider |
| `REPORT_EMAIL_API_URL/API_KEY` | optional | required for HTTP provider |
| `REPORT_SMS_PROVIDER` | fake SMS | real HTTP/Kavenegar provider |
| `REPORT_SMS_API_URL/API_KEY` | optional | required for HTTP provider |
| `REPORT_ADMIN_PASSWORD` | optional | optional, enables admin |
| `REPORT_WEB_AUTHN_RP_ID` | inferred for localhost | required final domain |
| `REPORT_WEB_AUTHN_ORIGINS` | inferred for localhost | required HTTPS origins |
| `REPORT_ARTIFACT_ROOT` | optional test root | required release artifact root |
| `REPORT_RELEASE_MANIFEST` | optional manifest override | optional |
| `HTTP_ADDR` | `:8080` | usually `127.0.0.1:8080` behind a proxy |

Never commit values for provider credentials, signing keys, delivery keys,
admin passwords, or WebAuthn production configuration.

## Production rules

Startup fails closed when production keys, persistent storage, HTTPS origin,
ZarinPal, or real delivery providers are missing. The service rejects demo
payments, local outbox, fake SMS, and ephemeral secrets in production.

The store uses SQLite WAL, foreign keys, a five-second busy timeout, and one
writer connection. Back up the database and the signing/delivery keys
separately. Postgres is a future measured scale option, not a current dependency.

## Release and deployment

```bash
cd server && go run ./cmd/publish-release
```

See [`docs/releases.md`](../docs/releases.md) for artifact handling and
[`docs/deployment.md`](../docs/deployment.md) for the planned VPS deployment.
