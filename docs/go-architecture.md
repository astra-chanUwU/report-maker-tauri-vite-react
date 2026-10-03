# Go architecture — modular monolith

> Sole backend is Go. No Convex, no Next.js in the core system. Report generation
> and `.sp3`/`.sp3 Data`-CSV handling stay offline in the Tauri desktop app.

## 1. Stack decisions

| Concern | Choice |
|---|---|
| Backend | Go modular monolith, single deployable binary |
| Web | Go `html/template` (or `templ`) server-rendered pages + HTMX for partial updates; no SPA framework for marketing/checkout flows |
| Desktop API | JSON `POST/GET/DELETE /v1/*` consumed by the existing Tauri React app |
| DB | SQLite first (`REPORT_DB_PATH`), with WAL, foreign keys, busy timeout, and offsite backups; move to Postgres only if multi-instance or high-concurrency requirements appear |
| Auth for desktop | Ed25519 device keypair held in OS keychain; signed lease in `X-Lease` / `X-Lease-Signature` / `X-Activation-Id` headers (same envelope as `docs/control-plane.md`) |
| Auth for web | Customer passkey-first sessions, email magic links, optional Argon2id passwords, and separate admin sessions; CSRF token on mutating web forms |
| Secrets | `REPORT_SIGNING_PRIVATE_KEY` (base64url 32-byte Ed25519 private key), `REPORT_SIGNING_KEY_ID`, `REPORT_DB_PATH`, WebAuthn RP settings, and provider keys (`OPENAI_API_KEY`, `POSTHOG_API_KEY`/`POSTHOG_HOST`) — all server-only; desktop ships only `REPORT_MAKER_LICENSE_PUBLIC_KEY` |
| Offline guarantee | Desktop remains usable offline for the duration of the signed lease (`offline_until`, default 30 days) and local report export never requires a network call |

### Non-goals

- No Convex realtime/DB layer. No Next.js runtime.
- `.sp3` files (Jet MDB) and `docx` generation never touch the server.
  The server only handles licenses, activations, AI proxy, and telemetry.

## 2. Module / domain boundaries

Single Go module (`go.mod`), single binary, packages enforce boundaries via
internal imports. `cmd/server` is the only entry point.

```
cmd/server/            main, config, graceful shutdown
internal/
  app/                 wiring: router, middleware, repository construction
  http/
    web/               handlers + templates for server-rendered pages (marketing, checkout, payment redirect/callback pages)
    api/               JSON handlers under /v1/* for the desktop app
    middleware/        request id, logging, recovery, rate limit, CSRF
  domain/
    licensing/         license model, key-hash lookup, plan/status/features
    activation/        device activation, device-limit checks, refresh/revoke, lease issuance
    payment/           order/intent, domestic gateway redirect, callback verification, state machine
    checkout/          cart/session, order creation, idempotency
    ai/                entitlement check, model allowlist, provider proxy, quota/usage
    telemetry/         opt-in ingestion, allowlist validation, PostHog forwarding queue
    admin/             license provisioning, activation inspection, revoke, usage views
  crypto/              canonical JSON (sorted keys, compact), b64url, sha256, Ed25519 sign/verify
  repo/                Repository interface + sqlite implementation + postgres implementation
  config/              env parsing, key loading
web/
  templates/           Go templates (base, partials, pages)
  static/              css/js/assets (served by Go or embedded via go:embed)
migrations/            sql migrations (golang-migrate / goose)
```

Rules:

- `domain/*` never imports `http/*`. It exposes services/repositories.
- `http/web` and `http/api` depend on `domain/*` and `crypto`, never on each other.
- `repo` exposes one `Repository` interface used by all domains. SQLite is the
  first production database, configured with WAL, foreign keys, a busy timeout,
  and offsite backups. A Postgres implementation is a later scale option, not a
  parallel requirement for the first deployment.
- `licensing` + `activation` share the same tables but separate services; `payment`
  owns orders and drives license provisioning on success.

## 3. Route categories

### 3.1 Web — server-rendered + HTMX

Served as HTML. Mutating forms carry CSRF token; HTMX swaps target fragments.

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Marketing landing |
| `GET` | `/pricing` | Plans/features |
| `GET` | `/checkout` | Checkout page (server-rendered form, HTMX validation) |
| `POST` | `/checkout` | Create order + payment intent, redirect to gateway |
| `GET` | `/checkout/success` | Order success page |
| `GET` | `/pay/redirect` | 302 to domestic gateway (see payment state machine) |
| `GET,POST` | `/pay/callback` | Gateway callback/verify — server-to-server verification, then redirect to success/failure page |
| `GET` | `/admin/login` | Admin login (form) |
| `POST` | `/admin/login` | Create admin session cookie |
| `GET` | `/admin/*` | License/activation/usage views, revoke actions (session-gated) |

### 3.2 API — JSON for Tauri desktop (`/v1/*`)

Keep contract from `docs/control-plane.md` compatible so
existing desktop builds continue to work. Errors always:
`{ "error": { "code": "machine_readable_code", "message": "…" } }`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/activations` | Optional `Idempotency-Key` | Activate device → `{ activation_id, lease, signature }` |
| `POST` | `/v1/activations/{id}/refresh` | Device signature proof | Refresh lease |
| `DELETE` | `/v1/activations/{id}` | Device signature proof | Revoke (idempotent, `204`) |
| `POST` | `/v1/ai/draft` | `X-Activation-Id` + `X-Lease` + `X-Lease-Signature` + device proof | Hosted AI draft (returns 5 fields: `summary, methodology, observations, recommendations, conclusion`) |
| `POST` | `/v1/telemetry/batch` | Optional `X-Activation-Id`, `consent: true` required | Allowlisted telemetry batch |

Validation preserves the existing contract: `license_not_available` / `device_limit_reached` /
`activation_revoked` / `invalid_lease` / `lease_expired` / `feature_not_entitled` /
`model_not_allowed` / `consent_required` / `event_not_allowed` / `rate_limited` etc.
`422 invalid_request` on schema errors, `500 internal_error` without leaking internals.

### 3.3 Health

- `GET /healthz` — liveness (no DB).
- `GET /readyz` — DB ping + signing key loaded.

## 4. Persistence

### Tables (SQLite first; repository boundary leaves room for a later Postgres adapter)

- `licenses(id, key_hash UNIQUE, plan, status, features JSON, max_devices, created_at, updated_at)`
- `activations(id PK, license_id FK, device_public_key_hash, device_public_key, platform, app_version, created_at, last_seen, revoked_at, UNIQUE(license_id, device_public_key_hash))`
- `orders(id PK, license_id FK nullable, activation_id nullable, amount, currency, status, gateway_ref, idempotency_key UNIQUE, created_at, updated_at, paid_at, verified_at)` — new for payment
- `payment_events(id BIGSERIAL, order_id FK, gateway_payload JSON, received_at, verified BOOL)`
- `ai_usage(id, activation_id FK, request_id, requested_at, model, token_estimate, result_status)`
- `telemetry_events(id, activation_id FK nullable, event_name, received_at, payload JSON)`
- `idempotency_keys(scope, key, response JSON, created_at, PK(scope,key))` — for activation idempotency
- `admin_sessions` or stateless signed cookie (prefer stateless HMAC cookie to avoid extra table)

Migrations live in `migrations/*.sql` and run on startup (`goose up` / `golang-migrate`).

### Repository wiring

```go
type Repository interface {
    FindLicense(key string) (*License, error)
    SeedLicense(key string, plan string, features map[string]bool, maxDevices int) (*License, error)
    GetActivation(id string) (*Activation, error)
    GetOrCreateActivation(license *License, deviceKey, platform, appVersion string) (*Activation, error)
    TouchActivation(id string) error
    RevokeActivation(id string) (bool, error)
    // payment
    CreateOrder(...) (*Order, error)
    GetOrder(id string) (*Order, error)
    MarkOrderPaid(id, gatewayRef string) error
    // ai / telemetry / idempotency
    SaveAIUsage(activationID, requestID, model string, estimate int, status string) error
    SaveTelemetry(activationID *string, events []TelemetryEvent) error
    GetIdempotent(scope, key string) (json.RawMessage, bool)
    PutIdempotent(scope, key string, resp json.RawMessage) error
}
```

`OpenStore(path string)` opens the SQLite database with one writer connection,
WAL mode, foreign keys, and a five-second busy timeout. The repository boundary
remains deliberate so Postgres can be added later if multiple service instances,
background workers, or analytics workloads make it worthwhile.

## 5. Payment state machine

Domestic gateway is redirect-based. Server never trusts the redirect querystring alone;
it verifies server-to-server before marking paid.

```
created ──► pending_redirect ──► pending_verify ──► paid
   │               │                     │
   │               │                     ├──► failed (gateway says not paid)
   │               │                     └──► expired
   │               └──── cancelled (user abort before verify)
   └──── failed (creation/validation error)
```

States stored in `orders.status`:

- `created` — order row inserted, idempotency key stored.
- `pending_redirect` — `GET /pay/redirect?order_id=…` issued 302 to gateway; gateway ref saved.
- `pending_verify` — user returned to `GET|POST /pay/callback`; server calls gateway verify API.
- `paid` — verify succeeded → provision license (insert `licenses` + link to order), render success page. Terminal.
- `failed` / `expired` / `cancelled` — terminal non-paid states.

Rules:

- Callback handler is idempotent; repeated gateway retries do not double-provision.
- Verification failure does not auto-retry with user-visible retry button only (`POST /pay/callback` re-verify, rate-limited).
- Amount/currency checked against order on verify; mismatch → `failed`.
- On `paid`, `SeedLicense` / `FindLicense` provisions the perpetual license; the desktop
  activates separately via `POST /v1/activations` (checkout and activation are decoupled).

Customer identity is a separate browser session boundary. The first implementation
provides `POST /auth/passkey/register/begin`, `POST /auth/passkey/register/finish`,
`POST /auth/passkey/login/begin`, `POST /auth/passkey/login/finish`, email
magic-link request/consume, optional password set/login, and `GET /account`.
Passkey ceremony state and credentials are stored in SQLite; the session cookie
never authenticates the desktop `/v1/*` endpoints. WebAuthn RP ID and origins are
explicit configuration so the final domain is chosen before production enrollment.

## 6. Phased implementation order

The first Go vertical slice is now present in `server/`: SQLite persistence,
health, activation/lease parity, hosted AI/telemetry contract handlers,
HTMX marketing/checkout pages, and a domestic payment adapter seam with
ZarinPal plus a local demo gateway. Customer identity, license delivery,
repeatable downloads, and admin workflows build on these boundaries.

| Phase | Scope | Acceptance |
|---|---|---|
| 0 — Scaffolding | `go.mod`, `cmd/server`, `internal/config`, `internal/crypto` (canonical JSON + Ed25519, port from `server/crypto.py`), `internal/repo` interface + SQLite impl, `migrations/`, `/healthz`/`/readyz` | `go test ./...` + `go vet` green; SQLite lease issuance works locally |
| 1 — Licensing + Activation (parity) | `domain/licensing`, `domain/activation`, JSON `POST /v1/activations`, `POST /v1/activations/{id}/refresh`, `DELETE /v1/activations/{id}`, same error codes and semantics as the documented contract | Existing desktop activates/refreshes/revokes against Go with no client change |
| 2 — Customer identity | Passkey-first sessions, email magic links, optional passwords, phone verification, and separate admin auth | A customer can sign in and view their purchases without authenticating desktop API routes |
| 3 — License delivery | Provision a signed license after verified payment, expose repeatable authenticated downloads, and send purchase email | A paid customer can redownload after an interrupted or expired transfer |
| 4 — AI + telemetry | Entitlement checks, provider proxy, deterministic fallback, consent-gated telemetry | Desktop AI drafts and telemetry preserve the desktop contract |
| 5 — Admin | Session auth, license/activation/usage views, revoke action, and order inspection | Admin can operate the service without direct DB edits |
| 6 — Scale option | Add a Postgres repository only if multiple writers, workers, or measured load justify it | Migration is tested from the SQLite schema and backups remain recoverable |

## 7. Cleanup / migration from the previous FastAPI prototype

The former Python prototype has been removed. The authoritative implementation
is the Go module in `server/`, with the public contract in `docs/control-plane.md`.

- The Go implementation preserves the JSON contracts, error codes, header names
  (`X-Lease`, `X-Lease-Signature`, `X-Activation-Id`, `Idempotency-Key`),
  canonical JSON signing, and lease fields (`lease_version`, `key_id`,
  `license_id`, `activation_id`, `device_public_key`, `plan`, `features`,
  `issued_at`, `offline_until`).
- **Data migration:** SQLite is persistent production state. Back it up offsite
  before upgrades and test restore. If future concurrency or operational needs
  justify Postgres, migrate from a verified SQLite backup through an explicit,
  tested migration rather than maintaining two databases now.
- Keep `REPORT_ALLOW_DEV_SEED` behavior (only when explicitly `1`) — do not
  enable it in Go production.
- Keep `server/README.md` and this document aligned as Postgres, provider, and
  admin adapters are added.

## 8. Config (env)

```
REPORT_DB_PATH=report-maker.db
ZARINPAL_MERCHANT_ID=…
ZARINPAL_BASE_URL=https://api.zarinpal.com
REPORT_SIGNING_PRIVATE_KEY=…     # base64url 32 bytes; generated if absent in dev only
REPORT_SIGNING_KEY_ID=lease-…    # key id stamped into leases
REPORT_ALLOW_DEV_SEED=0          # 1 only locally
OPENAI_API_KEY=…                 # server-only; empty → deterministic fallback
REPORT_AI_ALLOWED_MODELS=gpt-5-mini
REPORT_AI_MODEL=gpt-5-mini
POSTHOG_API_KEY=…                # server-only
POSTHOG_HOST=https://us.i.posthog.com
ADMIN_SESSION_SECRET=…           # HMAC key for admin cookie
REPORT_AI_RATE_LIMIT=30          # per activation per minute
REPORT_TELEMETRY_RATE_LIMIT=120  # per install id per minute
ADDR=:8080
```

## 9. Security notes

- Desktop is not the trust boundary; server is. Desktop verifies lease signature +
  device binding + `offline_until` locally via the embedded public key.
- Lease signature covers the canonical JSON of the lease object only.
- Device proof is Ed25519 over `{action, activation_id, request_id, payload_hash}`.
- Never return raw DB errors or stack traces; map to `{ error: { code, message } }`.
- Payment callback verifies server-to-server; redirect params alone never mark `paid`.
