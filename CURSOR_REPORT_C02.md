> **Superseded for integration status** by [CURSOR_REPORT.md](./CURSOR_REPORT.md) (C12). This file is historical slice notes only.
# C02 — Make checkout account-safe

## 1. Slice and outcome

Checkout now **find-or-creates** one durable customer per normalized email instead of inserting a new `customers` row on every purchase. Paid orders remain linked to that customer ID, so magic-link/passkey sign-in and `/account/purchases` show the full purchase history.

## 2. Files changed

| Area | Files |
|------|-------|
| Backend | `server/store.go`, `server/app.go`, `server/auth.go` |
| Tests | `server/checkout_account_test.go` |
| Docs | `docs/control-plane.md`, `TODO.md` |

## 3. Identity policy

| Account state | Checkout behavior |
|---------------|-------------------|
| New email | Create customer; store normalized email |
| Existing, phone **not** verified | Update name/phone from checkout |
| Existing, phone **verified** | Keep stored phone + surname; never clear `phone_verified_at`; order row keeps submitted contact |

Conflicts (different phone/surname vs verified account) return `CheckoutIdentityConflict` for future support audit — not shown to the buyer in C02.

## 4. Validation evidence

```text
cd server
GOPROXY=https://goproxy.io,https://goproxy.cn,direct GOSUMDB=off go test ./... -count=1
# ok   reportmaker/controlplane

GOPROXY=https://goproxy.io,https://goproxy.cn,direct GOSUMDB=off go vet ./...
# pass
```

## 5. Rebase notes for `integrate/control-plane`

Branch bases on `origin/feat/s02-license-provisioning` (`41bc3c9`). After C01 lands on integrate:

1. Rebase `feat/c02-checkout-account-safe` onto `integrate/control-plane`.
2. Keep `EnsureCheckoutCustomer` in `startCheckout` and shared `normalizeEmail`.
3. Low conflict risk — changes are localized to customer checkout/account paths.

## 6. Git state

- **Branch:** `feat/c02-checkout-account-safe`
- **Base:** `origin/feat/s02-license-provisioning`
- **Commit:** see `git log -1` after push
