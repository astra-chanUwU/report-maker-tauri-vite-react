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

**Status:** Implemented on `feat/s03-release-downloads` (see `CURSOR_REPORT_S03.md`).

- [x] Define release artifacts and versions outside the database seed path (`server/releases.json`, `REPORT_ARTIFACT_ROOT`, optional `REPORT_RELEASE_MANIFEST`).
- [x] Add authenticated customer download routes and a purchase/download page (`/account/downloads`, `/downloads/{artifact_id}`, expiring `/downloads/link/{token}`).
- [x] Permit repeated downloads, with renewable expiry and rate limiting (HMAC tokens, CSRF renew form, per-customer/IP limits).
- [x] Record download audit rows without storing report contents (`RecordDownload` → `download_records`).
- [x] Make the artifact path configurable and prevent path traversal or arbitrary filesystem reads (`ResolveArtifactPath` + tests).
- [x] Include a clear offline desktop download path and checksum information (downloads page shows platform, filename, SHA-256).

**Acceptance:** an entitled customer can download the same artifact multiple
  times, an expired link can be renewed after authentication, a non-entitled
  customer cannot download it, and path traversal tests fail safely.

### S04 — Receipts, magic links, and provider adapters

**Depends on:** S01 and S02.

**Status:** Implemented in control plane (see `CURSOR_REPORT_S04.md`). License
access mail is exported as `NotifyLicenseIssued` for S02 merge; paymentCallback
sends receipt-only until provisioning lands. Download access notify is stubbed
for S03.

- [x] Email interface with `LocalOutbox` for tests/dev; `NoopEmailSender` and
  `HTTPEmailSender` production hooks via `REPORT_EMAIL_*`.
- [x] Document domain auth (SPF/DKIM/DMARC) and required env vars in
  `server/README.md` without committing secrets.
- [x] Send via interface: purchase receipt (paymentCallback), license access
  (`NotifyLicenseIssued` hook for S02), magic link (existing auth path),
  download access (`NotifyDownloadAccess` stub for S03).
- [x] SMS interface with `FakeSMS`; optional `HTTPSMSSender` (Kavenegar-style)
  via `REPORT_SMS_*` with timeouts/retries/redacted logs.
- [x] Explicit timeouts, retries, redacted logs, and send idempotency keys.
- [x] Tests for message kind/recipient/ids, secret redaction, and paid-order
  recoverability when email is down.

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

## Cursor follow-up task pack

These tasks come from the GitHub review of the S01–S04 branches. They are more
specific than the broad slices above and should be completed in order. Start by
fetching `origin/main` and the three existing branches; do not merge them blindly
or rewrite their work.

### C00 — Establish the integration branch

**Owner:** Composer 2.5 High, reviewed by Grok 4.5 High
**Depends on:** none
**Status:** Done on `integrate/control-plane` (see `CURSOR_REPORT.md`).

- [x] Create a dedicated integration branch from current `main`.
- [x] Inspect `feat/s02-license-provisioning`, `feat/s03-release-downloads`, and
  `feat/s04-provider-adapters` with `git diff` before merging.
- [x] Record the intended merge order and conflicts in `CURSOR_REPORT.md`.
- [x] Keep `main` untouched until the integrated branch passes all checks.

**Acceptance:** the branch ancestry and scope are documented; no feature branch
is described as merged until its code is present in the integrated checkout.

### C01 — Repair SQLite upgrade migrations

**Owner:** Composer 2.5 High, reviewed by Grok 4.5 High
**Depends on:** C00
**Status:** Done — `schema_version` + migrations v1–v3 in `server/store_migrate.go`; regression tests in `server/store_migration_test.go`.

- [x] Make schema upgrades safe for the database created before S02.
- [x] Add columns before indexes, constraints, or queries that reference them.
- [x] Prefer numbered SQLite migrations or an equivalent schema-version table over a
  growing unversioned `migrate` function.
- [x] Test fresh install, old-schema upgrade, repeated startup, and restore from a
  backup (session-row preservation test; manual backup-restore checklist remains for C11).
- [x] Do not silently drop customer, order, license, activation, or session data.

**Acceptance:** an old fixture database opens successfully; `go test ./...`
contains a regression test for the exact `no such column: order_id` failure;
`go vet ./...` passes.

### C02 — Make checkout account-safe

**Owner:** Composer 2.5 High, reviewed by GPT-Sol 6.1 High
**Depends on:** C01
**Status:** Done — merged on `integrate/control-plane` (`EnsureCheckoutCustomer`, `normalizeEmail`, phone_verified preservation).

- [x] Normalize email consistently and find-or-create the customer during checkout.
- [x] Preserve the verified phone state when checkout updates contact details.
- [x] Document verified-identity conflict policy (no silent overwrite).
- [x] Link every paid order to the durable customer account used by sign-in.
- [x] Tests: repeat purchases, case-insensitive email, account purchase visibility.

**Acceptance:** two purchases using the same email appear under one customer
account; unrelated emails remain separate; no customer data is lost.

### C03 — Close license-key disclosure paths

**Owner:** Grok 4.5 High, implementation by Composer 2.5 High
**Depends on:** C02
**Status:** Done — merged on `integrate/control-plane` (`paymentCompleteDisclosure`, masked callback/status, authenticated reveal, license key redaction in logs).

- [x] Never show the plaintext license key on an unauthenticated callback replay.
- [x] Post-payment / checkout status pages show order status and masked key unless authenticated owner.
- [x] Authenticated reveal via `/account/purchases/reveal`; license-access email uses masked hint.
- [x] No reusable receipt bearer token; sign-in remains the recovery path.
- [x] Delivery AES key separate from Ed25519 lease signing key.

**Acceptance:** an unauthenticated repeat callback cannot recover the full key;
the owning customer can recover it after sign-in; another customer cannot.

### C04 — Integrate payment, license, email, and downloads

**Owner:** GPT-Sol 6.1 High orchestrator; Composer 2.5 High implementation (GPT-Sol unavailable — Composer 2.5 used)
**Depends on:** C01–C03
**Status:** Done — merged C02/C03 on `integrate/control-plane`; `notifyAfterPaidOrder` wired; `server/c04_e2e_flow_test.go`.

- [x] Merge S02, S04, and S03 preserving final contracts (C00/C01 base).
- [x] Merge C02 account-safe checkout and C03 license disclosure.
- [x] Integrated flow test: checkout → verify → license → emails → account → download.
- [x] Callback retries, ZarinPal 101, provider outage, expired-link renewal covered in tests.
- [x] Wire `NotifyLicenseIssued` and `NotifyDownloadAccess` on paid fulfillment.
- [x] One payment → one license / one entitlement (idempotent fulfill).

**Acceptance:** one integrated Go test package covers the full flow and passes
with both the demo gateway and a mocked ZarinPal server.

### C05 — Add Go checks to GitHub Actions

**Owner:** Composer 2.5 High
**Depends on:** C04

- Add Go setup, module download, `go test ./...`, and `go vet ./...` to CI.
- Run the migration-upgrade test and any race-safe tests that are appropriate for
  the SQLite single-writer design.
- Keep frontend, Rust, and Go results visibly separate in the workflow.
- Do not mark a branch complete based only on npm/Rust CI.

**Acceptance:** a clean GitHub Actions run proves frontend, Rust, and Go checks
on the same commit.

### C06 — Make production configuration fail closed

**Owner:** Grok 4.5 High review; Composer 2.5 High implementation
**Depends on:** C04

- Demo payments require an explicit development-only flag.
- Production startup fails without persistent signing and license-delivery keys,
  a database path, and required provider configuration.
- Do not silently use `FakeSMS`, `LocalOutbox`, or the demo gateway in production.
- Keep provider errors bounded, redacted, timed out, and observable to admin
  support without exposing secrets.
- Add request-size limits, secure cookie checks, CSP, and local HTMX assets.

**Acceptance:** a production-config test rejects unsafe defaults; development
configuration still runs without external credentials.

### C07 — Publish real release artifacts

**Owner:** Composer 2.5 High, reviewed by GPT-Luna 6 High
**Depends on:** C04

- Replace placeholder `releases.json` data and checksums with real signed release
  artifacts for the supported macOS and Windows targets.
- Define the release publication process and artifact retention policy.
- Verify checksums before download and show install instructions in the account
  page.
- Keep artifact paths outside the SQLite database and reject traversal/symlink
  escapes.

**Acceptance:** a locally published artifact downloads repeatedly, its checksum
matches, and the release manifest is documented and reproducible.

### C08 — Wire Iranian email and SMS providers

**Owner:** Composer 2.5 High, reviewed by Grok 4.5 High
**Depends on:** C04 and provider credentials supplied by the owner

- Map the generic email adapter to the selected Iranian transactional provider.
- Map SMS OTP requests to the selected Iranian SMS provider.
- Keep provider-specific payloads behind interfaces and preserve local fakes for
  tests.
- Add persistent delivery status or an outbox retry record so a process restart
  does not lose a receipt or license message.
- Document SPF, DKIM, DMARC, sender identity, SMS templates, timeouts, and retry
  limits without committing secrets.

**Acceptance:** provider sandbox/manual checks are recorded separately from
automated tests; failures remain retryable and paid orders stay recoverable.

### C09 — Build the minimum admin support console

**Owner:** Composer 2.5 High, security review by Grok 4.5 High
**Depends on:** C04 and C06

- Add customer/order/payment search by order ID, email, phone, and payment ref.
- Show payment, license, email, SMS, download, and activation status.
- Add narrowly scoped actions: resend delivery, revoke activation, and mark a
  support note; audit every mutation.
- Keep admin authentication separate from customer sessions and do not expose
  password hashes, passkey credential material, raw tokens, or provider secrets.

**Acceptance:** a customer cookie cannot access admin routes; a support operator
can resolve a paid order without direct SQL; mutations have audit records.

### C10 — Complete the marketing and customer UX

**Owner:** Composer 2.5 High, product review by GPT-Sol 6.1 High
**Depends on:** C04 and C07

- Add product explanation, pricing, purchase, sign-in, account, purchases, and
  downloads pages as one coherent journey.
- Add Persian/RTL-ready layout and copy without changing the desktop React app.
- Add privacy, refund, support, offline-use, and checksum/install guidance.
- Make pending, cancelled, failed, and successful payment states clear.
- Avoid adding Next.js, Convex, or a separate SPA runtime.

**Acceptance:** anonymous purchase, customer sign-in, purchase history, and
repeatable download journeys work in a real browser against the local service.

### C11 — Deploy and verify the first VPS

**Owner:** GPT-Sol 6.1 High architecture; Composer 2.5 High implementation
**Depends on:** C05–C10

- Document the Iran-hosted VPS profile, domain, HTTPS reverse proxy, firewall,
  service user, environment file, and artifact storage.
- Add health/readiness checks and graceful shutdown.
- Automate SQLite backup plus restore verification and separately protect signing
  and delivery keys.
- Configure the final WebAuthn RP ID/origin before enrolling production passkeys.
- Record live provider checks as unavailable until credentials and domain DNS are
  actually verified.

**Acceptance:** a clean VPS-style environment restores the database, starts the
service, passes health checks, serves HTTPS, and supports the configured passkey
origin.

### C12 — Final review and cleanup

**Owner:** Grok 4.5 High
**Depends on:** C11

- Remove stale TODO claims, duplicate reports, placeholder prices/checksums, and
  dead FastAPI/Postgres references that no longer describe the implementation.
- Confirm all docs match the actual routes, environment variables, and schema.
- Run the full validation matrix and classify automated, HTTP, browser/device,
  desktop interoperability, and live-provider evidence separately.
- Produce `CURSOR_REPORT.md` with exact commits, known limitations, and a clean
  Git status. Do not claim production readiness without browser, provider, and
  restore evidence.

**Acceptance:** the final report is reviewable, no secrets are committed, the
working tree is clean, and `main` contains only reviewed integrated work.

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
