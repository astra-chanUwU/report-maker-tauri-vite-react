# CURSOR_REPORT — S04 Receipts, magic links, and provider adapters

## 1. Slice and outcome

Implemented provider adapters and customer notification hooks for the Go
control plane without rewriting auth.

- Email: `EmailSender` retained; `LocalOutbox` for tests/dev; `NoopEmailSender`
  and `HTTPEmailSender` (timeouts, retries, idempotency headers, redacted logs).
- SMS: `FakeSMS` extended with kind + idempotency; optional `HTTPSMSSender`.
- Sends: purchase receipt from `paymentCallback` after paid; magic link via
  existing auth path; `NotifyLicenseIssued` exported for S02; download access
  stubbed via `NotifyDownloadAccess` for S03.
- Provider outage after verify does not undo paid order state.

Remaining: live Iranian email/SMS credentials and domain DNS (SPF/DKIM/DMARC)
are not exercised here. S02 must call `NotifyLicenseIssued` when provisioning.

## 2. Files changed

**Backend**

- `server/providers.go` — interfaces, LocalOutbox/FakeSMS, HTTP stubs, redaction
- `server/notify.go` — receipt / license / download notify helpers + paid hook
- `server/app.go` — env wiring; `notifyAfterPaidOrder` after `MarkOrderPaid`
- `server/auth.go` — magic-link kind constant + idempotency key
- `server/phone.go` — SMS kind + idempotency key

**Tests**

- `server/providers_test.go` — kinds, recipients, ids, redaction, outage

**Docs**

- `server/README.md` — provider env vars and domain auth checklist
- `TODO.md` — S04 checklist marked complete
- `CURSOR_REPORT_S04.md` — this report

## 3. Architecture decisions

- Kept flat `controlplane` package; notify helpers live next to providers.
- Default adapters remain local/fake so `ConfigFromEnv` is safe without secrets.
- HTTP skeletons are env-configured generic transactional/SMS clients suitable
  for an Iranian provider or Kavenegar-style SMS; no secrets committed.
- License email is an exported hook (`NotifyLicenseIssued`) so S02 can merge
  without rewriting S04; payment path sends receipt-only until then.

## 4. Security/privacy review

- Magic-link tokens stay in email body/outbox only; production still omits
  `X-Dev-Magic-Link` unless `AllowDevSeed`.
- Logs redact bearer tokens, api_key/token fields, query tokens, and long
  opaque strings; SMS success logs omit message body/codes.
- Payment remains committed before email; email errors are logged, not fatal.
- Idempotency keys on receipt/license/magic-link/SMS sends reduce duplicate
  provider traffic on retries.

## 5. Validation evidence

```text
cd server
GOPROXY=https://goproxy.io,https://goproxy.cn,direct GOSUMDB=off
go test ./... -count=1   # ok reportmaker/controlplane
go vet ./...             # exit 0
```

- Automated: pass
- HTTP (httptest): pass for callback receipt + outage recoverability
- Browser/device: not run
- Live email/SMS provider: not run (no credentials)

## 6. Known limitations

- HTTP email/SMS clients are skeletons; map payload fields to the final vendor
  contract when credentials exist.
- License-access email is not auto-sent from paymentCallback until S02 stores
  a license and calls `NotifyLicenseIssued`.
- Download-access email waits on S03 artifact routes.
- Domain SPF/DKIM/DMARC must be completed on the production host.

## 7. Next slice

Recommend merging order: **S02 → S04 → S03** (or S04 → S02 if S04 lands first;
S02 should call `NotifyLicenseIssued`). S03 can use `NotifyDownloadAccess`.
S05 (ZarinPal harden) should follow S02+S04.

## 8. Git state

- Branch: `feat/s04-provider-adapters`
- Worktree: isolated from S02 (`feat/s02-license-provisioning`)
- Do not merge `main` into this branch as part of this slice
- No secrets committed
