# Go architecture — modular monolith

> Sole backend is Go in `server/`. No Convex, no Next.js in the core system.
> Report generation and `.sp3`/Data-CSV handling stay offline in the Tauri desktop app.
> SQLite is the production database for the first deployment.

## 1. Stack decisions

| Concern | Choice |
|---|---|
| Backend | Go modular monolith, single deployable binary (`server/cmd/controlplane`) |
| Web | Go `html/template` + HTMX; no SPA for marketing/checkout |
| Desktop API | JSON under `/v1/*` for the Tauri app |
| DB | SQLite (`REPORT_DB_PATH`), WAL, foreign keys, busy timeout, single writer, offsite backups |
| Auth for desktop | Ed25519 device keypair in OS keychain; signed lease headers (`X-Lease`, `X-Lease-Signature`, `X-Activation-Id`) |
| Auth for web | Customer passkey-first sessions, magic links, optional Argon2id passwords; separate admin cookie |
| Secrets | `REPORT_SIGNING_PRIVATE_KEY`, `REPORT_LICENSE_DELIVERY_KEY`, `REPORT_DB_PATH`, WebAuthn RP settings, provider keys — server-only; desktop ships only the lease public key |
| Offline guarantee | Desktop usable offline for the signed lease window; local report export never requires the network |

### Non-goals

- No Convex realtime/DB layer. No Next.js runtime.
- `.sp3` files and DOCX generation never touch the server.
- Do not replace SQLite with Postgres for the first production host. A Postgres
  repository remains a later scale option only after measured need for multiple
  writers or multiple service instances.

## 2. Layout (as implemented)

Single Go module under `server/` (`module reportmaker/controlplane`). Package
`controlplane` holds the HTTP app, store, providers, and templates. Entry point:

```
server/
  cmd/controlplane/     main, listen, graceful shutdown
  cmd/publish-release/  fixture/real artifact publisher
  *.go                  App, routes, auth, payments, downloads, admin, store, migrations
  templates.go          html/template pages
  static/               embedded HTMX and assets
  releases.json         default release manifest (fixture SHA-256 values)
  testdata/             test fixtures
```

Rules that matter in this codebase:

- Customer browser sessions never authenticate `/v1/*`.
- Payment callbacks never trust browser-supplied amounts; the gateway verify
  result is compared to the stored order amount.
- License keys are hashed for lookup; recoverable delivery ciphertext uses
  `REPORT_LICENSE_DELIVERY_KEY` (separate from the Ed25519 lease signing key).
- Email/SMS go through interfaces; production wraps sends in SQLite `delivery_outbox`.

## 3. Route categories

### 3.1 Web — server-rendered + HTMX

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Marketing landing |
| `GET` | `/pricing` | Plans + checkout form |
| `GET` | `/download` | Public download guidance (entitled users redirect to account downloads) |
| `POST` | `/checkout/start` | Create order + start gateway redirect |
| `GET` | `/checkout/status` | Pending/paid/failed order status (masked license unless owner session) |
| `GET` | `/payments/{provider}/redirect` | 302 to gateway |
| `GET` | `/payments/{provider}/callback` | Gateway return → server verify → fulfill |
| `GET` | `/login` | Customer sign-in |
| `POST` | `/auth/magic-link/request` | Request magic link |
| `GET` | `/auth/magic-link/consume` | Consume magic link → session |
| `POST` | `/auth/password/set` | Set password (authenticated) |
| `POST` | `/auth/password/login` | Password login |
| `POST` | `/auth/passkey/register/begin` / `finish` | WebAuthn registration |
| `POST` | `/auth/passkey/login/begin` / `finish` | WebAuthn login |
| `POST` | `/auth/logout` | End customer session |
| `POST` | `/auth/phone/request-code` / `verify` | Phone OTP |
| `GET` | `/account` | Customer account |
| `GET` | `/account/purchases` | Purchase history |
| `POST` | `/account/purchases/reveal` | Reveal plaintext license (owner only) |
| `GET` | `/account/downloads` | Entitled downloads |
| `POST` | `/account/downloads/renew` | Renew expiring download link |
| `GET` | `/downloads/{artifact_id}` | Authenticated artifact download |
| `GET` | `/downloads/link/{token}` | HMAC expiring download link |
| `GET` | `/admin/login` | Admin login (requires `REPORT_ADMIN_PASSWORD`) |
| `POST` | `/admin/login` / `/admin/logout` | Admin session |
| `GET` | `/admin` | Minimal admin home (support console is C09) |

### 3.2 API — JSON for Tauri desktop (`/v1/*`)

Errors: `{ "error": { "code": "…", "message": "…" } }`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/activations` | Optional `Idempotency-Key` | Activate device → lease + signature |
| `POST` | `/v1/activations/{id}/refresh` | Device signature proof | Refresh lease |
| `DELETE` | `/v1/activations/{id}` | Device signature proof | Revoke (`204`) |
| `POST` | `/v1/ai/draft` | Lease headers + device proof | Hosted AI draft (five fields) |
| `POST` | `/v1/telemetry/batch` | Optional activation; `consent: true` required | Allowlisted telemetry |

### 3.3 Health

- `GET /healthz` — liveness
- `GET /readyz` — currently same handler as liveness (DB readiness hardening is C11)

## 4. Persistence (SQLite)

Schema version table: `schema_version` (current version **4** on integrate tip).
Migrations live in `server/store_migrate.go` (`migrationV1`…`migrationV4`).

Core tables:

- `customers`, `webauthn_credentials`, `webauthn_challenges`, `magic_links`, `customer_sessions`
- `licenses` (key hash, plan/features, optional `customer_id` / `order_id`, `delivery_ciphertext`)
- `activations`
- `orders`, `payment_attempts`
- `download_records`
- `idempotency`
- `phone_challenges`
- `admin_sessions`
- `delivery_outbox` (email/SMS retry queue)

`OpenStore` uses one writer connection, WAL, foreign keys, and a five-second busy timeout.

## 5. Payment state machine

Domestic gateway is redirect-based. Browser query params alone never mark paid.

```
pending ──► (redirect) ──► callback ──► verify ──► paid (+ provision license)
                              │
                              ├── cancelled / failed / mismatch
                              └── already verified (ZarinPal 101) → idempotent
```

Rules:

- Amounts are integer rials from the server catalog (`REPORT_PERPETUAL_PRICE_RIALS`, default `1000000`).
- Callback handler is idempotent across retries and verify code `101`.
- On paid: provision one license, enqueue receipt + license-access + download-access notifications.
- Unauthenticated callback/status pages show a **masked** license; plaintext reveal requires the owning customer session.

## 6. Config (env)

Authoritative matrix: `server/README.md` and `server/config.go`. Highlights:

```
REPORT_ENV=development          # or production fail-closed default
REPORT_ALLOW_DEV_SEED=1         # development only
REPORT_ALLOW_DEMO_PAYMENTS=1    # development only
REPORT_DB_PATH=report-maker.db
PUBLIC_BASE_URL=https://…       # https required in production
REPORT_SIGNING_PRIVATE_KEY=…    # base64url 32-byte seed
REPORT_SIGNING_KEY_ID=…
REPORT_LICENSE_DELIVERY_KEY=…   # base64url 32-byte AES key
ZARINPAL_MERCHANT_ID=…
REPORT_EMAIL_PROVIDER=http      # production; local/outbox for dev
REPORT_SMS_PROVIDER=kavenegar   # production; fake for dev
REPORT_ADMIN_PASSWORD=…         # optional; enables /admin
REPORT_ARTIFACT_ROOT=…
REPORT_WEB_AUTHN_RP_ID=…
REPORT_WEB_AUTHN_ORIGINS=…
HTTP_ADDR=:8080
```

## 7. Historical note

An earlier FastAPI/Python prototype was removed. The authoritative implementation
is the Go module in `server/` with the public contract in `docs/control-plane.md`.
Do not reintroduce a second backend stack.
