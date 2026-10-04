> **Superseded for integration status** by [CURSOR_REPORT.md](./CURSOR_REPORT.md) (C12). This file is historical slice notes only.
# C04 — End-to-end flow tests

**Branch:** `feat/c04-e2e-flow-tests`  
**Base:** `origin/integrate/control-plane` @ `b43b071` (includes C02 + C03)  
**Authoritative suite:** `server/c04_flow_test.go`  
*(Replaces the thinner `server/c04_e2e_flow_test.go` that landed on integrate during parallel work.)*

## Scope

One integrated package covering:

1. Full demo flow: checkout → payment OK → one license → LocalOutbox receipt + license_access → magic-link purchases → entitled repeat download  
2. Mocked ZarinPal `100` and already-verified `101` → still one license  
3. Callback retry idempotency (second callback, no second license / no duplicate receipt)  
4. Cancelled / mismatched callback → zero licenses  
5. Provider outage after fulfill → order remains `paid` + license  
6. Expired download link → renew after auth → download works  
7. Unauthenticated status/callback HTML: masked `RM-` only; owning session can reveal  
8. Privacy: purchase outbox has no full key; `redactSecrets` strips magic-link tokens and full keys  

C04 TODO acceptance / product wiring stays with the integrate agent (already marked on integrate). This branch ships the thorough test package.

## Results (current tip with C02/C03)

```text
$env:GOPROXY="https://goproxy.io,https://goproxy.cn,direct"
$env:GOSUMDB="off"
& "C:\Program Files\Go\bin\go.exe" test ./... -count=1 -timeout 180s
& "C:\Program Files\Go\bin\go.exe" vet ./...
```

| Test | Result |
|---|---|
| `TestC04FullDemoFlowCheckoutToRepeatDownload` | **PASS** |
| `TestC04ZarinPal100And101StillOneLicense` (`code100`, `code101_idempotent`) | **PASS** |
| `TestC04CallbackRetryIdempotent` | **PASS** |
| `TestC04CancelledAndMismatchedCallbackZeroLicenses` | **PASS** |
| `TestC04ProviderOutageAfterFulfillRemainsRecoverable` | **PASS** |
| `TestC04ExpiredDownloadLinkRenewAfterAuth` | **PASS** |
| `TestC04UnauthenticatedStatusAndCallbackHideFullKey` (status anon / owner / callback) | **PASS** |
| `TestC04PrivacyOutboxAndLogsRedactSecrets` (outbox / token / license key) | **PASS** |
| `TestC04CheckoutDurableCustomer` | **PASS** |

`go vet ./...` clean. Full `go test ./...` green.

### Earlier integrate-only tip (pre-C02/C03)

On `7568506` (S02/S03/S04/C01 only), the same suite soft-skipped three C02/C03 contracts via `t.Skip`. Those skips were converted to hard asserts after rebasing onto C02/C03.

## Merge instructions for `integrate/control-plane`

1. Merge **`feat/c04-e2e-flow-tests`** into `integrate/control-plane`.
2. Expect deletion of `server/c04_e2e_flow_test.go` in favor of `server/c04_flow_test.go` (broader coverage; `c04*`-prefixed helpers avoid C02/C03 symbol clashes).
3. Re-run:

   ```text
   cd server
   go test ./... -count=1 -timeout 180s
   go vet ./...
   ```

4. Keep C04 marked done in `TODO.md` only if the integrate agent already accepted the product wiring; this branch does not re-claim C04.

## Helpers reused

- `fetchCSRF` (`auth_test.go`)
- `testDeliveryKey`, `checkoutWithGateway`, `startZarinPalPendingOrder`, `buildCallbackURL` (`license_provision_test.go`)
- `failingEmailSender`, `seedPendingOrder` (`providers_test.go`)
- C02: `normalizeEmail`, durable `customer_id` via checkout
- C03: masked anonymous callback/status; `licenseKeyRE` in `redactSecrets`
