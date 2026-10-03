# Control-plane integration — C00 through C04

**Model:** Composer 2.5 (GPT-Sol 6.1 High orchestrator unavailable; Grok 4.5 High unavailable for review).

See also: `CURSOR_REPORT_C04.md` (C04 detail), `CURSOR_REPORT_C03.md` (C03 branch notes).

## Branch ancestry

| Step | Commit | Source |
|------|--------|--------|
| Base | `e1b304d` | `origin/main` |
| S02 merge | `93f7842` | `origin/feat/s02-license-provisioning` |
| S04 merge | `83fdc10` | `origin/feat/s04-provider-adapters` |
| S03 merge | `895962e` | `origin/feat/s03-release-downloads` |
| C01 migrations | `9ecd153` | numbered SQLite schema migrations |
| C02 merge | `44a7223` | `origin/feat/c02-checkout-account-safe` (`546ea5f`) |
| C03 merge + C04 | *(tip after push)* | `origin/feat/c03-license-disclosure` (`7ccb390`) + C04 wiring/tests |

**Branch:** `integrate/control-plane` — **not merged to `main`**.

## C04 outcome

Integrated payment → license → email → download on one branch:

- **C02:** `EnsureCheckoutCustomer`, `normalizeEmail`, phone_verified preservation, account purchase visibility tests
- **C03:** `paymentCompleteDisclosure`, masked callback/status, authenticated reveal, license key log redaction
- **Notifications:** `notifyAfterPaidOrder` fires receipt + masked license-access + download-access (idempotent outbox keys)
- **Tests:** `server/c04_e2e_flow_test.go` + existing S02/S03/S04/C02/C03 test packages

## Validation evidence

```text
cd server && go test ./... -count=1 -timeout 180s
# ok  reportmaker/controlplane  3.523s

cd server && go vet ./...
# exit 0
```

Go 1.27.0 windows/amd64; `GOPROXY=https://goproxy.io,https://goproxy.cn,direct`; `GOSUMDB=off`.

## Remaining gaps (C05+)

| Task | Status |
|------|--------|
| **C05** CI Go checks | Not started |
| **C06** Production fail-closed config | Not started |
| **C07** Real release artifacts | Placeholder checksums |
| **C08** Live Iranian email/SMS | Interface only |
| **C09** Admin support console | Not started |
| **C10** Marketing/customer UX polish | Partial templates |
| **C11** VPS deploy | Not started |
| Browser passkey / live ZarinPal | Manual, not verified |

**Recommended next:** C05 — Add Go checks to GitHub Actions.

## Git state

- **Branch:** `integrate/control-plane`
- **main:** untouched
- **Pushed:** `origin/integrate/control-plane` after C04 commit
