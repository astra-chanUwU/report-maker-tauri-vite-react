# Report Maker Go service

This directory contains the Go modular service described in [`docs/go-architecture.md`](../docs/go-architecture.md). It serves the marketing and checkout pages and the JSON control-plane API used by the Tauri desktop app.

## Run locally

```bash
cd server
REPORT_ALLOW_DEV_SEED=1 go run ./cmd/controlplane
```

The development seed provisions `RM-TEST-1234-KEY0` in the in-memory store. It must remain disabled for shared or production deployments. A signing key is generated for each development process; production deployments must set a persistent base64url-encoded 32-byte `REPORT_SIGNING_PRIVATE_KEY` and `REPORT_SIGNING_KEY_ID`.

Useful environment variables:

- `HTTP_ADDR` (default `:8080`)
- `PUBLIC_BASE_URL` (default `http://localhost:8080`)
- `REPORT_ALLOW_DEV_SEED=1` for local activation tests
- `REPORT_PERPETUAL_PRICE_RIALS` for the server-side plan price
- `REPORT_SIGNING_PRIVATE_KEY` and `REPORT_SIGNING_KEY_ID` for persistent lease signing

The `PaymentGateway` interface in `payment.go` is the boundary for a domestic redirect processor such as ZarinPal/ZarinPay. `DemoGateway` is only a local flow that exercises pending order, redirect, callback, server-side verification, and idempotent paid state. A production adapter must call the provider's request and verification APIs and compare the verified amount to the stored order amount before provisioning a license.

The Go service uses SQLite first. `REPORT_DB_PATH` selects the persistent file;
the store enables WAL, foreign keys, a five-second busy timeout, and a single
writer connection. Back up the database and signing configuration off the VPS.
Postgres remains a future option if deployment grows beyond one service process.

The service intentionally keeps report files and `.sp3` data on the desktop.
Hosted AI and telemetry endpoints remain contract-compatible with the desktop
client. Set `ZARINPAL_MERCHANT_ID` to select the ZarinPal adapter; without it,
the local DemoGateway is used. Set `ZARINPAL_BASE_URL` only for the documented
provider endpoint or a test server.
