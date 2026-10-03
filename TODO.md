# Report Maker implementation guide for Cursor

This file is the handoff for finishing the Report Maker product from the current
checkout. Work in small, reviewable slices. Do not rewrite the application or
introduce a second backend stack.

## Product and architecture decisions

- The backend is a single Go modular monolith in `server/`.
- The public website is Go `html/template` plus HTMX. The Tauri desktop app
  remains React/TypeScript and talks to the Go JSON API under `/v1/*`.
- SQLite is the first production database. Keep WAL, foreign keys, the busy
  timeout, a single writer connection, persistent `REPORT_DB_PATH`, and tested
  offsite backups. Do not replace SQLite with Postgres. A Postgres repository is
  only a later scale option after measured need for multiple writers, workers,
  or multiple service instances.
- Report generation, `.sp3`/CSV data, DOCX export, and local files remain on the
  desktop. The service receives only the metadata required by its contracts.
- ZarinPal is the first payment provider. The flow is request → redirect →
  callback → server-side verify → amount check → idempotent paid order.
- Customer identity is separate from admin identity. Customers provide actual
  first name, surname, email, and Iranian phone number. The intended order is
  passkey first, email magic link/passwordless fallback, and optional password
  fallback. Customer sessions must never authenticate desktop `/v1/*` routes.
- A paid customer can download the release repeatedly. Downloads may be
  authenticated or renewable expiring links with rate limits; they must not be
  one-time links as the normal experience.
- Email is required for receipts, magic links, and download access. SMS is for
  phone verification or recovery. Keep provider calls behind interfaces.
- AI and telemetry reuse the activation/entitlement boundary. Telemetry remains
  consent-gated and must not contain report contents or identifying project data.

## Current checkout: do not discard it

The checkout already contains uncommitted implementation for:

- Ed25519 device keys and signed offline leases in Rust.
- Tauri licensing, AI entitlement, and consented telemetry changes.
- Go health, activation, refresh, revoke, AI, and telemetry contracts.
- SQLite persistence for customers, orders, licenses, activations, payment
  attempts, challenges, sessions, and downloads.
- ZarinPal request/verify adapter plus local demo gateway.
- Go marketing/pricing/checkout/callback pages.
- Customer passkey ceremony endpoints, magic-link sessions, and Argon2id
  password fallback.

Read these before editing:

- `docs/go-architecture.md`
- `docs/control-plane.md`
- `docs/licensing.md`
- `server/README.md`
- `server/app.go`, `server/store.go`, `server/payment.go`, `server/auth.go`
- the existing Tauri license/AI/telemetry files

Preserve unrelated work. Inspect `git status`, the current diff, and the current
runtime before changing anything.

## Model allocation in Cursor

Use the strongest available model for review and the implementation model for
routine changes. If these model names are available in Cursor:

- **Grok 4.5, high:** architecture, security review, payment/auth threat review,
  schema decisions, difficult debugging, and final diff review.
- **Composer 2.5, high:** implementation, tests, migrations, templates, and
  routine integration work after the slice contract is clear.
- If Cursor supports one model orchestrating the other, use Grok 4.5 high as
  the reviewer/orchestrator and Composer 2.5 high as the implementer. The
  orchestrator must give Composer a bounded slice and inspect its diff before
  accepting it.
- If either named model is unavailable, use the closest available high-quality
  equivalent and record that substitution in the report.

Do not split one slice across competing unreviewed edits. One implementation
agent owns a slice; the reviewer checks the resulting diff and tests.

## Slice protocol

For every slice:

1. Start by stating the slice objective, files likely to change, dependencies,
   and acceptance checks.
2. Inspect the real code and database schema before proposing changes.
3. Implement the smallest vertical path that can be exercised locally.
4. Add meaningful tests for contracts, persistence, idempotency, and security
   boundaries. Do not add tests that merely mirror implementation details.
5. Run the checks listed below and record exact results.
6. Review the diff for accidental scope, secrets, privacy leaks, and stale docs.
7. Commit the slice on a dedicated branch with a message such as
   `feat(control-plane): license delivery slice`.
8. Do not push or merge without an explicit instruction from the repository
   owner.
9. Write a concise handoff report before moving to the next slice.

A slice is complete only when its acceptance checks pass and its remaining
limitations are written down. Do not mark a browser/device acceptance test as
passed because a Go unit test passed.

## Remaining implementation slices

### S01 — Finish customer identity for production use

**Depends on:** current SQLite/auth groundwork.

**Status:** Implemented in control plane (see `CURSOR_REPORT.md`). Remaining manual check: real browser passkey registration/login on configured RP ID/origin.

Complete the passkey-first customer account flow:

- [x] Add a small browser client for WebAuthn JSON ceremony responses (inline JS
  on login/account pages; no npm/SPA).
- [ ] Verify registration and discoverable login on the configured RP ID and
  origin (**manual browser check remaining**).
- [x] CSRF protection for mutating browser forms; rate limits for magic links,
  password login, and passkey attempts; session rotation after login.
- [x] WebAuthn credential counters via `TouchWebAuthnCredential`; challenges
  remain single-use and expiring.
- [x] Email-provider interface (`LocalOutbox`); production path omits token from
  responses/headers (`X-Dev-Magic-Link` only when `AllowDevSeed`).
- [x] Phone verification (`phone_verified_at`, `FakeSMS` interface).
- [x] Separate admin auth (`report_maker_admin_session`, `REPORT_ADMIN_PASSWORD`).

**Acceptance:** protocol tests pass; a real browser passkey registration and
login are manually verified on the chosen domain; magic-link tokens are never
returned in production responses; `go test ./...` and `go vet ./...` pass.

### S02 — Provision a license after verified payment

**Depends on:** S01 and the existing ZarinPal adapter.

**Status:** Implemented in control plane (see `CURSOR_REPORT.md`).

- [x] Define the license product and plan data in one server-owned catalog.
- [x] Generate a unique license key only after a verified payment.
- [x] Store only a hash for lookup plus encrypted/recoverable customer delivery data
  according to the security review; never put the signing private key in the
  client or browser.
- [x] Make provisioning transactionally idempotent across callback retries and
  ZarinPal verification code `101`.
- [x] Associate the license with the customer and order. Do not provision on a
  client-supplied callback amount or an unverified authority.
- [x] Add a customer purchase page showing order status and license entitlement.

**Acceptance:** demo gateway and a mocked ZarinPal server both prove that one
paid order yields one license; failed, mismatched, repeated, and cancelled
callbacks cannot create a license.

### S03 — Repeatable release downloads

**Depends on:** S01 and S02.

- Define release artifacts and versions outside the database seed path.
- Add authenticated customer download routes and a purchase/download page.
- Permit repeated downloads, with renewable expiry and rate limiting.
- Record download audit rows without storing report contents.
- Make the artifact path configurable and prevent path traversal or arbitrary
  filesystem reads.
- Include a clear offline desktop download path and checksum information.

**Acceptance:** an entitled customer can download the same artifact multiple
  times, an expired link can be renewed after authentication, a non-entitled
  customer cannot download it, and path traversal tests fail safely.

### S04 — Receipts, magic links, and provider adapters

**Depends on:** S01 and S02.

- Add an email interface with a local outbox implementation for tests.
- Add production configuration for the selected Iranian transactional email
  provider and domain authentication.
- Send purchase receipt, license access, magic-link, and download messages.
- Add an SMS interface for phone verification/recovery and a local fake.
- Keep provider timeouts, retries, redacted logs, and idempotency explicit.

**Acceptance:** tests assert message type, recipient, order/license identifiers,
  and that secrets/tokens are not logged. Provider outages leave the order state
  recoverable and visible to support.

### S05 — Harden the ZarinPal production path

**Depends on:** S02 and S04.

- Keep all amounts in integer rials and compare the verified amount to the
  stored order amount.
- Validate authority, callback status, merchant configuration, and order
  ownership. Treat verification codes `100` and `101` according to the provider
  contract, with idempotent state transitions.
- Add timeout, bounded response-body, retry, and redacted error handling.
- Add a test server covering request, redirect, callback, verify success,
  already-verified, mismatch, cancellation, provider error, and retry behavior.
- Never trust `order_id`, email, or mobile values returned by the browser.

**Acceptance:** all payment tests pass without live credentials; the live
  sandbox/manual checklist is documented separately from automated tests.

### S06 — Admin operations

**Depends on:** S01–S05.

Build a separate admin boundary for:

- admin login/session and CSRF protection;
- customer/order/payment search;
- license provisioning/revocation and activation inspection;
- download and provider delivery status;
- safe audit log and support lookup by order/customer/phone.

Do not expose customer passwords, passkey private material, raw magic-link
contents, provider secrets, or the signing private key in admin views.

**Acceptance:** admin routes reject customer sessions, support can resolve an
order without direct database edits, and all mutating actions are audited.

### S07 — Marketing website and purchase UX

**Depends on:** S02–S04.

Keep the website server-rendered with Go templates and HTMX:

- landing page explaining offline report generation;
- pricing/product page;
- checkout form for name, surname, email, and Iranian phone;
- ZarinPal redirect and clear pending/success/failure pages;
- sign-in/account/purchases/downloads pages;
- FAQ, privacy, refund/support, and contact pages;
- responsive RTL-capable styling if Persian copy is introduced.

Do not add Next.js, Convex, or a second frontend runtime for this service.

**Acceptance:** anonymous marketing, checkout, authenticated account, and repeat
 download journeys work in a browser against the local Go service.

### S08 — AI and telemetry production boundaries

**Depends on:** S02 and existing desktop contract.

- Require a valid activation/entitlement for hosted AI.
- Keep provider keys server-side, allowlist models, apply per-activation limits,
  and preserve deterministic fallback behavior when unavailable.
- Keep telemetry disabled until explicit consent, validate an event allowlist,
  redact payloads, and provide retention/deletion controls.
- Add integration tests proving the service never receives `.sp3` bytes, paths,
  project names, report text, or raw exception messages.

**Acceptance:** desktop contract tests remain green, unauthorized AI is rejected,
  consent-off telemetry makes no request, and privacy tests pass.

### S09 — Deployment, backups, and release operations

**Depends on:** S01–S08.

- Document an Iran-hosted VPS deployment with 2–4 vCPU, 4 GB RAM, 40–80 GB NVMe,
  public IPv4, HTTPS, outbound provider access, and offsite backups.
- Add service configuration, migrations, health checks, graceful shutdown, log
  redaction, firewall/reverse-proxy guidance, and artifact storage.
- Automate SQLite backup plus restore verification. Back up the signing key
  separately with restricted access.
- Choose and configure the final domain before production passkey enrollment.
- Document ZarinPal, email, SMS, domain, and VPS secrets without committing any
  values.

**Acceptance:** a clean VPS-style environment can restore the database, start the
service, pass health checks, and serve HTTPS with the configured WebAuthn origin.

### S10 — Final verification and handoff

**Depends on:** all required slices.

Run and record:

```text
cd server && go test ./...
cd server && go vet ./...
npm run typecheck
npm test -- --run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml -q
git diff --check
```

Also separate results for automated tests, HTTP tests, browser passkey/payment
checks, desktop interoperability, and unavailable live-provider checks.

## Required report for the repository owner

After each completed slice, and again at the end, write a report for review. Save
the final report as `CURSOR_REPORT.md` and also return it in the Cursor response.
Do not claim work is complete merely because files changed.

Use this structure:

1. **Slice and outcome** — what was implemented and what remains.
2. **Files changed** — grouped by backend, website, desktop, docs, and tests.
3. **Architecture decisions** — choices made and why they fit the SQLite-first
   Go monolith.
4. **Security/privacy review** — auth boundary, secrets, CSRF, rate limits,
   payment verification, download authorization, and telemetry redaction.
5. **Validation evidence** — exact commands and pass/fail results, separated by
   automated, HTTP, browser/device, and live-provider checks.
6. **Known limitations** — especially anything not verified with a real browser,
   ZarinPal credentials, SMS, email, VPS, or domain.
7. **Next slice** — one bounded recommendation with dependencies and acceptance
   checks.
8. **Git state** — branch, commit, changed files, and whether anything remains
   uncommitted. Never include secrets.

The report should be factual, concise, and suitable for another engineer to
review. If blocked, explain the exact external dependency and leave the checkout
in a recoverable state.

## Historical format notes

- `.sp3` is an MS Access Jet database. Raw `.sp3` is not readable in the WebView.
- CSV export of the `Data` table is the supported current ingestion path.
- `Specdata` contains `\ooo` octal escapes for float32 little-endian amplitudes.
- Frequency is derived as `(i + 1) * BandWidth`.
- Large files must not be fully decoded just to sniff their format.
- Preserve existing offline report generation and DOCX behavior while service work
  proceeds.
