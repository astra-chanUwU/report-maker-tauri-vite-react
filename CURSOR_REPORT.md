# S02 — Provision a license after verified payment

## 1. Slice and outcome

Implemented transactional license provisioning after server-verified payment:

- Server-owned product catalog (`catalog.go`) — perpetual plan with price, features, max devices from env/catalog only
- Unique `RM-XXXX-XXXX-XXXX` keys generated only after verified payment (DemoGateway + ZarinPal codes 100/101)
- Key hash stored for activation lookup; AES-GCM encrypted delivery copy via `REPORT_LICENSE_DELIVERY_KEY`
- `FulfillOrderPayment` marks order paid and provisions exactly one license, linking `customer_id`, `order_id`, and `license_id`
- Idempotent on callback retries and ZarinPal already-verified (101)
- Customer `/account/purchases` with masked keys and CSRF-protected reveal; checkout success shows plaintext key once
- No provisioning on cancelled, unmatched, or failed verify paths

**Remaining:** Purchase receipt email (S04); production `REPORT_LICENSE_DELIVERY_KEY` rotation policy; browser manual checkout walkthrough.

## 2. Files changed

### Backend (`server/`)
- `catalog.go` — new server-owned plan catalog
- `license_delivery.go` — key generation, AES-GCM encrypt/decrypt, masking
- `store.go` — schema columns (`orders.license_id`, license customer/order/delivery), `FulfillOrderPayment`, customer orders list
- `app.go` — fulfillment wired into payment callback; catalog-driven checkout/pricing
- `auth.go` — `/account/purchases`, `/account/purchases/reveal`
- `templates.go` — purchase list, license display on checkout status
- `README.md` — `REPORT_LICENSE_DELIVERY_KEY` documented

### Tests
- `license_provision_test.go` — new (demo, ZarinPal 100/101, failure paths, activation)
- `app_test.go` — payment callback expects license key
- `store.go` / `downloads_test.go` / `releases.go` — FK-safe test helper, path traversal fix (coexists with partial S03)

### Docs
- `TODO.md` — S02 checkboxes marked complete

## 3. Architecture decisions

- Catalog is in-process map (not client-supplied); `REPORT_PERPETUAL_PRICE_RIALS` overrides price only
- Provisioning runs in one SQLite transaction: mark paid → insert license → set `orders.license_id`
- Idempotent path returns decrypted key for already-paid orders without inserting again
- Delivery encryption uses separate key from Ed25519 lease signing key
- Flat `controlplane` package preserved

## 4. Security/privacy review

| Area | Implementation |
|------|----------------|
| Payment authority | Verify uses stored `order.AmountRials`, not callback query params |
| Key storage | SHA-256 hash for lookup; plaintext only in encrypted `delivery_ciphertext` |
| Signing key | Never in client; lease signing unchanged |
| Customer reveal | Session must own order; CSRF on reveal POST |
| Checkout success | Full key shown once post-verify (anonymous buyer copy window) |

## 5. Validation evidence

### Automated (Go)
```text
cd server && go test ./... -count=1 -timeout 120s
# ok  reportmaker/controlplane  1.691s

cd server && go vet ./...
# exit 0
```

### Protocol tests (license_provision_test.go)
- Demo gateway: one paid order → one license; retry → still one
- ZarinPal mock verify (100) → one license
- ZarinPal code 101 double callback → one license
- Cancelled / unmatched / failed verify → zero licenses
- Provisioned key activates via `POST /v1/activations`

### Browser / live provider
- **Not verified** — manual browser checkout and live ZarinPal sandbox

## 6. Known limitations

- No purchase receipt or license email yet (S04)
- `REPORT_LICENSE_DELIVERY_KEY` must be set persistently in production or encrypted keys become undecryptable after restart
- Checkout success page shows key to anyone with callback URL (short window); repeat access requires account session
- S03 download tests/helpers adjusted for FK order but full download slice not in this branch scope

## 7. Next slice

**S03 — Repeatable release downloads** (partial code present): wire entitlement to S02-provisioned licenses end-to-end, renew expiring links, path traversal tests on all platforms.

## 8. Git state

- Branch: `feat/s02-license-provisioning`
- Commit: pending in agent run
- Not merged to `main`
