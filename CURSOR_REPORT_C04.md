> **Superseded for integration status** by [CURSOR_REPORT.md](./CURSOR_REPORT.md) (C12). This file is historical slice notes only.
# C04 — Integrate payment, license, email, and downloads

**Model:** Composer 2.5 (GPT-Sol 6.1 High orchestrator unavailable — Composer 2.5 used for implementation).

## Slice and outcome

Merged **C02** (`546ea5f`) and **C03** (`7ccb390`) into `integrate/control-plane` on top of C00/C01 (S02→S04→S03 + schema migrations). Wired `notifyAfterPaidOrder` to send receipt, masked license-access, and download-access emails on every successful payment fulfillment (idempotent via outbox keys). Post-payment pages use C03 `paymentCompleteDisclosure` (masked key unless authenticated owner).

**Done:** integrated E2E tests in `server/c04_e2e_flow_test.go`.

**Remaining for C05+:** CI Go checks (C05), production fail-closed config (C06), real release artifacts (C07), live Iranian email/SMS (C08), admin console (C09), full marketing UX (C10), VPS deploy (C11).

## Merges performed

| Step | Source | Result |
|------|--------|--------|
| 1 | `origin/feat/c02-checkout-account-safe` @ `546ea5f` | Merged; TODO.md conflict resolved |
| 2 | `origin/feat/c03-license-disclosure` @ `7ccb390` | Merged; conflicts in `app.go`, `notify.go`, `providers.go`, `TODO.md` |

`feat/c04-e2e-flow-tests` was not on origin — tests authored locally.

## Conflict resolutions

| File | Resolution |
|------|------------|
| `server/app.go` | C03 `paymentCompleteDisclosure` + `notifyAfterPaidOrder` (not C03-only `afterLicenseProvisioned`) |
| `server/notify.go` | Full S04 notify stack: receipt + license (masked hint, account URL) + download; unified `notifyAfterPaidOrder` |
| `server/providers.go` | Kept S04 HTTPEmailSender/HTTPSMSSender; added C03 `licenseKeyRE` in `redactSecrets` |
| `server/store.go` | Auto-merged; C01 migrations + C02 `EnsureCheckoutCustomer` preserved |
| `TODO.md` | Marked C02–C04 done on integration branch |

## Notifications wired

- `paymentCallback` → `fulfillVerifiedPayment` → `notifyAfterPaidOrder`
- Receipt: `NotifyPurchaseReceipt` (idempotency `receipt:{order_id}`)
- License: `NotifyLicenseIssued` with `MaskLicenseKey` hint (idempotency `license_access:{license_id}`)
- Download: `NotifyDownloadAccess` when `CustomerDownloadEntitlement` succeeds (idempotency `download_access:{order_id}`)
- Email failures logged only; paid order + license state never rolled back

## Validation evidence

```text
cd server && go test ./... -count=1 -timeout 180s
# ok  reportmaker/controlplane  3.523s

cd server && go vet ./...
# exit 0
```

Environment: Go 1.27.0 windows/amd64; `GOPROXY=https://goproxy.io,https://goproxy.cn,direct`; `GOSUMDB=off`.

### C04 acceptance tests (`server/c04_e2e_flow_test.go`)

- `TestC04DemoCheckoutFullFlow` — checkout → demo verify → one license → 3 emails → magic-link account purchases → repeat download → callback retry idempotent
- `TestC04ZarinPalMockedFullFlow` — mocked provider codes 100 and 101
- `TestC04ProviderOutageAfterPaymentRecoverable`
- `TestC04ExpiredDownloadLinkRenewAfterAuth`
- `TestC04TwoCheckoutsSameEmailOneCustomer`

Existing packages also cover C03 disclosure (`license_disclosure_test.go`), C02 account linking (`checkout_account_test.go`), S02 provisioning, S03 downloads, S04 providers.

## Known limitations

- No browser/manual passkey or live ZarinPal sandbox verification
- Placeholder release artifacts (C07)
- Production config still allows demo gateway / LocalOutbox without explicit dev flag (C06)
- No GitHub Actions Go job yet (C05)

## Next slice

**C05 — Add Go checks to GitHub Actions** — depends on C04 ✓.

## Git state

- **Branch:** `integrate/control-plane` (not merged to `main`)
- **Commits:** C02 merge, C03 merge + C04 implementation (see `git log` after push)
