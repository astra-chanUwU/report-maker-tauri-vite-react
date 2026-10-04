> **Superseded for integration status** by [CURSOR_REPORT.md](./CURSOR_REPORT.md) (C12). This file is historical slice notes only.
# CURSOR_REPORT_C03 — Close license-key disclosure paths

## Slice and outcome

C03 is implemented on branch `feat/c03-license-disclosure`, based on
`origin/feat/s02-license-provisioning` (commit `41bc3c9`).

**Closed:** plaintext license keys are no longer rendered on unauthenticated
payment callbacks (first response or replay) or on anonymous checkout-status
views. Masked keys remain visible. Owning authenticated customers can still
recover the full key via `/checkout/status` (session-owned) and
`/account/purchases/reveal`. Cross-customer reveal is rejected.

**Intentionally not added:** a short-lived receipt bearer URL. Sign-in + purchases
reveal is enough; a receipt token would risk becoming a reusable license-key
proxy.

**Hook for C04:** `afterLicenseProvisioned` → `NotifyLicenseIssued` sends a
masked license-access email through `LocalOutbox` / `EmailSender` with no
plaintext key in the body or URL.

## Files changed

| Area | Files |
|------|-------|
| Backend | `server/app.go` (callback/status disclosure), `server/notify.go` (new), `server/providers.go` (kinds, idempotent outbox, redaction) |
| Website | templates unchanged; disclosure driven by `PageData.LicenseKey` vs `LicenseMasked` |
| Tests | `server/license_disclosure_test.go` (new) |
| Docs | `CURSOR_REPORT_C03.md`, `TODO.md` (C03 status) |

## Architecture decisions

1. **Disclosure policy:** plaintext only when `customerFromRequest` matches
   `order.CustomerID`. Callbacks and status pages share that rule.
2. **No receipt bearer:** avoids a second secret channel that could be logged,
   forwarded, or replayed as a license key.
3. **Delivery key vs signing key:** `REPORT_LICENSE_DELIVERY_KEY` (AES-GCM at
   rest) remains independent of `REPORT_SIGNING_PRIVATE_KEY` (Ed25519 leases).
4. **Email:** `NotifyLicenseIssued` uses `DeliveryHint = MaskLicenseKey(...)` and
   links to `/account/purchases` (no token query params).

## Security / threat model summary

| Threat | Mitigation |
|--------|------------|
| Attacker replays gateway callback URL | Page shows order ID + masked key only; full key never in HTML |
| Attacker opens `/checkout/status?order=` | Same masking without owning session |
| Attacker signs in as different customer | Reveal returns 404; status stays masked |
| License email interception | Email contains masked hint + sign-in link only |
| Log scraping | `redactSecrets` strips license-key shaped strings from notify error logs |
| Confused delivery/signing keys | Separate env vars and key material |

**Residual risk:** masked keys still leak prefix/suffix characters (inherent to
the mask format). C02 (find-or-create customer by email) still needed so magic-link
sign-in always lands on the same customer ID that owns the order.

## Validation evidence

```text
cd server
set GOPROXY=https://goproxy.io,https://goproxy.cn,direct
set GOSUMDB=off
go test ./... -count=1   # PASS
go vet ./...             # PASS
```

Automated disclosure tests:

- `TestUnauthenticatedCallbackDoesNotRevealFullKey`
- `TestOwningCustomerCanRevealLicenseAfterSignIn`
- `TestOtherCustomerCannotRevealLicense`
- `TestLicenseAccessEmailUsesMaskedKeyOnly`

Browser / live ZarinPal / production email: not exercised in this slice.

## Known limitations

- Branch is based on S02, not yet rebased onto `integrate/control-plane`.
- C02 account-safe checkout (email find-or-create) is still a prerequisite for
  production recovery UX; disclosure controls themselves are complete.
- S04’s richer `notify.go` / HTTP email adapters should merge onto this hook in
  C04 rather than duplicate call sites.

## Next slice / merge notes

1. Rebase `feat/c03-license-disclosure` onto `integrate/control-plane` after
   C00/C01 (and preferably after C02).
2. C04 should keep `NotifyLicenseIssued` / `afterLicenseProvisioned` as the
   provision-time email path and extend with receipt + download notify.
3. When merging S04 providers, preserve `IdempotencyKey` on
   `license_access:<licenseID>` and redaction helpers.

## Git state

- Branch: `feat/c03-license-disclosure`
- Base: `origin/feat/s02-license-provisioning`
- Do not merge to `main` from this slice.
