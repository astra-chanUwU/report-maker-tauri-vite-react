> **Superseded for integration status** by [CURSOR_REPORT.md](./CURSOR_REPORT.md) (C12). This file is historical slice notes only.
# CURSOR_REPORT — S03 Repeatable release downloads

## 1. Slice and outcome

Implemented repeatable, entitled desktop release downloads in the flat `controlplane` package. Customers with a **paid order linked to a license** (`orders.status='paid'` and `orders.license_id` set) can download release artifacts repeatedly via session-authenticated routes or renewable HMAC expiring links. Download attempts are audited in `download_records` without storing file contents.

**Remains:** browser/manual verification of the downloads page UX; real artifact files and production checksums in `releases.json`; S02 must populate `license_id` on payment (stub test helper provided until then).

## 2. Files changed

**Backend**
- `server/releases.json` — embedded default manifest (artifact id, version, filename, sha256, relative path).
- `server/releases.go` — catalog loader, `REPORT_ARTIFACT_ROOT` resolution, path traversal guard.
- `server/downloads.go` — routes, HMAC download tokens, rate limits, `RecordDownload`.
- `server/store.go` — `Order.LicenseID`, entitlement queries, `FindLicensesByCustomer`, `InsertPaidOrderWithLicense` test helper.
- `server/app.go` — config env wiring, catalog init, route registration.
- `server/templates.go` — `/account/downloads` page with checksum and renew form.

**Tests**
- `server/downloads_test.go` — entitled repeat download, expired link renew, non-entitled denied, path traversal denied.

**Docs**
- `TODO.md` — S03 progress checkboxes.
- `CURSOR_REPORT_S03.md` — this report.

## 3. Architecture decisions

- **Manifest outside DB:** Release versions live in `releases.json` (embedded) or `REPORT_RELEASE_MANIFEST`; binaries under `REPORT_ARTIFACT_ROOT`. No seeding of artifact metadata in SQLite.
- **Entitlement boundary:** `CustomerDownloadEntitlement` requires `paid` + non-empty `license_id`. Designed for S02 to set `license_id` during `FulfillOrderPayment`; S03 does not provision licenses.
- **Two download paths:** (1) session cookie on `GET /downloads/{artifact_id}`; (2) HMAC token on `GET /downloads/link/{token}` with configurable TTL (`REPORT_DOWNLOAD_LINK_TTL_HOURS`, default 24h). Expired tokens return 401; signed-in customers renew via `POST /account/downloads/renew` (CSRF) or by revisiting `/account/downloads`.
- **Rate limit:** Shared sliding window limiter keyed by customer ID + IP (`REPORT_DOWNLOAD_RATE_LIMIT`, default 30 / 15 min).
- **Desktop API unchanged:** `/v1/*` routes untouched.

## 4. Security / privacy review

- Path traversal blocked in manifest validation (`..`) and at serve time (`ResolveArtifactPath` prefix check).
- Non-entitled sessions receive 403; unsigned/expired tokens receive 401.
- CSRF on link renew POST; download audit records order/license/artifact id only.
- Signing key reused for HMAC download tokens (same server secret material as leases).

## 5. Validation evidence

```text
cd server
$env:GOPROXY='https://goproxy.io,https://goproxy.cn,direct'
$env:GOSUMDB='off'
& 'C:\Program Files\Go\bin\go.exe' test ./... -count=1 -timeout 120s   → PASS (1.764s)
& 'C:\Program Files\Go\bin\go.exe' vet ./...                           → PASS
```

Automated tests cover: `TestEntitledRepeatDownload`, `TestExpiredLinkRenewAfterAuth`, `TestNonEntitledDownloadDenied`, `TestPathTraversalDenied`.

**Not run:** browser passkey/download journey, live artifact hosting, production manifest deployment.

## 6. Known limitations

- `InsertPaidOrderWithLicense` is a test helper; S02 owns real provisioning and should set `orders.license_id` idempotently on verify.
- `FindLicensesByCustomer` is ready for purchase pages but not wired to S02 purchase UI yet.
- Default embedded SHA-256 is placeholder until release ops publishes real installer hashes.
- Manual browser check of downloads page not performed in this slice.

## 7. S02 integration

Rebase `feat/s03-release-downloads` onto S02 when ready:

1. S02 sets `orders.license_id` (and optionally `licenses.order_id`) in `FulfillOrderPayment` — entitlement queries work without S03 changes.
2. Replace test-only `InsertPaidOrderWithLicense` usage with payment callback integration tests on the merged branch.
3. Optional: link `/account/purchases` to `/account/downloads` once S02 purchase page lands.

## 8. Git state

- **Branch:** `feat/s03-release-downloads`
- **Commit:** pending (see below)
- **Push:** attempted to `origin` if network allows

## Config reference

| Env | Purpose |
|-----|---------|
| `REPORT_ARTIFACT_ROOT` | Directory containing release files (default `artifacts`) |
| `REPORT_RELEASE_MANIFEST` | Optional JSON manifest path (default: embedded `releases.json`) |
| `REPORT_DOWNLOAD_LINK_TTL_HOURS` | Expiring link lifetime (default 24) |
| `REPORT_DOWNLOAD_RATE_LIMIT` | Max downloads per customer+IP per 15 min (default 30) |
