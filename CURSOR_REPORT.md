# Control-plane integration — C00 / C01

**Model:** Composer 2.5 (closest available to Composer 2.5 High; Grok 4.5 High unavailable for review in this session).

## C00 — Integration branch

### Branch ancestry

| Step | Commit | Source |
|------|--------|--------|
| Base | `e1b304d` | `origin/main` |
| S02 merge | `93f7842` | `origin/feat/s02-license-provisioning` (`41bc3c9`) |
| S04 merge | `83fdc10` | `origin/feat/s04-provider-adapters` (`3eeb06d`) |
| S03 merge | `895962e` | `origin/feat/s03-release-downloads` (`6c9bb28`) |
| C01 migrations | `9ecd153` | this session |

**Branch:** `integrate/control-plane` (not merged to `main`).

### Merge order and rationale

1. **S02** — license provisioning, encrypted delivery, downloads scaffold, purchase templates.
2. **S04** — email/SMS adapters, receipt/license/download notify helpers.
3. **S03** — release-download slice; overlapped S02 download files.

S02 already contained partial `downloads.go` / `releases.go`; S03 was merged last with `-X ours` on overlapping server files so **paid+`license_id` entitlement** and S02 provisioning contracts win.

### Conflicts resolved

| File | Resolution |
|------|------------|
| `server/app.go` (S04) | Combined download config (S02) with `EmailSender`/`SMSSender` (S04); kept `fulfillVerifiedPayment` + wired `notifyAfterPaidOrder(fulfilled)`. |
| `server/notify.go` | Extended to call `NotifyLicenseIssued` and `NotifyDownloadAccess` when fulfillment includes a license. |
| `server/downloads.go`, `releases.go`, `downloads_test.go` (S03) | Kept S02 versions (license-bound entitlement). |
| `server/store.go` (S03) | **Restored S02 store** after S03 `-X ours` accidentally dropped `FulfillOrderPayment` / `Order.LicenseID`. |
| `server/templates.go` (S03) | Kept S02 purchases + masked license + download UX. |

### Present vs missing after C00

| Area | Status |
|------|--------|
| S02 license provisioning + idempotent fulfill | Present |
| S04 LocalOutbox, notify helpers, provider tests | Present |
| S03 repeatable downloads (HMAC tokens, renew, audit) | Present (via S02 merge; S03 docs only delta) |
| Checkout account linking (C02) | **Missing** — checkout still creates a new customer per order |
| License key disclosure hardening (C03) | **Partial** — masked key on callback; full C03 not done |
| End-to-end integrated flow test (C04) | **Missing** |
| Real release artifacts (C07) | Placeholder `releases.json` checksums |
| Production fail-closed config (C06) | Not started |
| CI Go checks (C05) | Not started |

---

## C01 — SQLite upgrade migrations

### Problem

Pre-S02 databases had `licenses` without `order_id`. The old monolithic `migrate()` ran `CREATE INDEX … ON licenses(order_id)` **before** `ALTER TABLE` added the column → startup error `no such column: order_id`.

### Fix

- Added `schema_version` table and **numbered migrations** in `server/store_migrate.go`:
  - **v1:** baseline S01 tables (no S02 license columns/indexes in initial DDL)
  - **v2:** customer identity `ALTER` columns
  - **v3:** license delivery columns, then indexes (`licenses_order_idx`, `orders_customer_idx`)
- Removed inline `migrate()` from `store.go`.
- No data-dropping statements; upgrades are additive.

### Tests added (`server/store_migration_test.go`)

- Fresh install → version 3, delivery columns queryable
- Pre-S02 fixture upgrade preserves customer/order/license/session rows
- Repeated startup (3×) idempotent
- **`TestSchemaMigrationNoSuchColumnOrderIDRegression`** — reproduces v1+v2 legacy DB without `order_id`, asserts `OpenStore` succeeds

### Validation evidence

```text
cd server && go test ./... -count=1 -timeout 180s
# ok  reportmaker/controlplane  3.074s

cd server && go vet ./...
# exit 0
```

Environment: Go 1.27.0 windows/amd64; `GOPROXY=https://goproxy.io,https://goproxy.cn,direct`; `GOSUMDB=off`.

Updated `providers_test.go` so paid callback expects receipt + license + download emails when provisioning succeeds.

---

## Git state

- **Branch:** `integrate/control-plane`
- **Tip:** `9ecd153` fix(control-plane): numbered SQLite schema migrations (C01)
- **Pushed:** `origin/integrate/control-plane` (after push step)
- **main:** untouched

---

## Remaining gaps (C02–C04)

| Task | Gap |
|------|-----|
| **C02** | `EnsureCheckoutCustomer` / email normalization at checkout; repeat-purchase account tests |
| **C03** | Callback replay must not reveal plaintext key; authenticated reveal only |
| **C04** | Single integrated test: checkout → pay → license → emails → account purchase → repeat download; ZarinPal 101 / retry cases |

**Recommended next:** C02 on this branch (depends on C01 ✓).
