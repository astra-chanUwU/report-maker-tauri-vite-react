# Go service architecture

The Go service in `server/` is a single modular monolith. It is the second
deployable in this repository, alongside the Tauri desktop application.

The service owns customer identity, orders, payment verification, license
delivery, activations, downloads, support administration, and the small JSON
contracts used by the desktop app. The desktop app owns report files, spectra,
MDB/CSV parsing, report editing, and DOCX generation.

## Stack decisions

| Concern | Choice |
| --- | --- |
| Backend | Go, one service binary at `server/cmd/controlplane` |
| Website | Go `html/template` plus embedded HTMX |
| Desktop API | JSON endpoints under `/v1/*` |
| Database | SQLite with WAL, foreign keys, busy timeout, and one writer |
| Customer auth | Passkey-first sessions, magic-link/passwordless fallback, optional Argon2id password |
| Admin auth | Separate admin session and CSRF-protected support routes |
| Desktop auth | Ed25519 device keypair and signed offline leases |
| Payments | Redirect gateway adapter with server-side verification; ZarinPal first |
| Delivery | Provider interfaces plus persistent SQLite outbox |
| Report data | Local to the desktop; not uploaded by normal report generation |
| Scale path | Consider Postgres only after measured need for multiple writers or service instances |

There is no Convex or Next.js runtime in this architecture. Adding a second
backend or a second web frontend would duplicate ownership without solving a
current problem.

## Repository layout

```text
server/
  cmd/controlplane/     service entry point and graceful shutdown
  cmd/publish-release/  release manifest publisher
  *.go                  routes, auth, payments, downloads, admin, store
  templates.go          server-rendered HTML
  static/               embedded HTMX and local assets
  releases.json         default release manifest
  testdata/             test-only artifact fixtures
```

## HTTP surface

### Website and customer account

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Marketing landing page |
| GET | `/pricing` | Product and checkout form |
| GET | `/download` | Public download guidance |
| POST | `/checkout/start` | Create a pending order and begin redirect payment |
| GET | `/checkout/status` | Show order state and masked license information |
| GET | `/payments/{provider}/redirect` | Redirect to the domestic gateway |
| GET | `/payments/{provider}/callback` | Verify the gateway result and fulfill the order |
| GET | `/login` | Customer sign-in |
| POST | `/auth/*` | Passkey, magic-link, password, phone, and logout actions |
| GET | `/account`, `/account/purchases` | Customer account and purchase history |
| GET/POST | `/account/downloads*` | Repeatable downloads and link renewal |
| GET | `/downloads/*` | Authenticated or expiring artifact download |
| GET | `/privacy`, `/refund`, `/support`, `/offline-use`, `/install`, `/faq` | Public information pages |

### Admin support

Admin routes use a separate cookie and never accept a customer session:

```text
GET  /admin/login
POST /admin/login
POST /admin/logout
GET  /admin
GET  /admin/orders/{order_id}
POST /admin/orders/{order_id}/resend-delivery
POST /admin/orders/{order_id}/support-note
POST /admin/activations/{activation_id}/revoke
```

Admin pages expose support state without exposing passwords, passkey private
material, raw magic-link contents, provider secrets, or signing keys.

### Desktop JSON API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/activations` | Activate a device and issue a signed lease |
| POST | `/v1/activations/{id}/refresh` | Refresh a lease with device proof |
| DELETE | `/v1/activations/{id}` | Revoke an activation |
| POST | `/v1/ai/draft` | Return an entitled hosted draft |
| POST | `/v1/telemetry/batch` | Validate consented, allowlisted events |

Customer browser sessions do not authenticate these endpoints. The desktop
client sends the activation id, signed lease, and device proof instead.

Health endpoints are `GET /healthz` and `GET /readyz`. They currently share the
same lightweight handler; deeper dependency readiness is still a deployment
hardening item.

## Persistence

The current schema version is **5**. Migrations are numbered in
`server/store_migrate.go`:

- customer identity, WebAuthn credentials, challenges, sessions, and phone OTP;
- licenses, activations, orders, and payment attempts;
- download audit rows and idempotency records;
- email/SMS delivery outbox;
- admin audit log and support notes.

`REPORT_DB_PATH` must point to a persistent file in production. The store enables
WAL, foreign keys, a five-second busy timeout, and a single writer connection.
Back up the database and the signing/delivery keys separately.

## Security boundaries

- The lease signing private key and license-delivery encryption key stay on the
  service.
- The desktop stores its device private key in the OS keychain and verifies the
  lease in Rust before exposing entitlement status to React.
- Payment callbacks never trust browser-supplied amounts or order ownership.
- License keys are hashed for lookup and only revealed to the owning customer.
- Hosted AI receives the limited contract payload, not `.sp3` bytes, paths, or
  report files. Offline fallback remains available.
- Telemetry is off by default, requires explicit consent, and rejects forbidden
  report or identifying fields.
