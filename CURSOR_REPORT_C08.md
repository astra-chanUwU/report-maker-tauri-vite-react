# CURSOR_REPORT_C08 — Iranian email/SMS providers + persistent outbox

**Branch:** `feat/c08-iran-providers`  
**Base:** `origin/integrate/control-plane` @ `5772302`  
**Live provider checks:** **unavailable** (owner credentials not supplied)

## Summary

- Email: `REPORT_EMAIL_PROVIDER` supports `local`, `kavenegar`/`http`, `smtp`, `outbox`, `noop`. Generic SMTP fallback via `REPORT_SMTP_*`.
- SMS: `REPORT_SMS_PROVIDER=kavenegar` uses Kavenegar REST adapter; `FakeSMS` unchanged for tests.
- Persistent SQLite `delivery_outbox` (schema v4): enqueue before send, retry on startup (30s budget) and throttled HTTP flush (10s).
- Production env apps wrap senders in persistent outbox; tests that inject `LocalOutbox`/`FakeSMS` skip the wrap.
- Documentation: `docs/providers.md`, `server/README.md` updated.

## Tests

```
cd server && go test ./... && go vet ./...
ok  	reportmaker/controlplane	(passed)
```

New tests in `delivery_outbox_test.go`: reopen survival, retry on failure, idempotency, env wiring, redaction, explicit fakes.

## Environment variables

| Area | Variables |
| --- | --- |
| Email | `REPORT_EMAIL_PROVIDER`, `REPORT_EMAIL_API_URL`, `REPORT_EMAIL_API_KEY`, `REPORT_EMAIL_FROM`, `REPORT_EMAIL_FROM_NAME`, `REPORT_EMAIL_TIMEOUT_MS`, `REPORT_EMAIL_MAX_RETRIES`, `REPORT_SMTP_HOST`, `REPORT_SMTP_PORT`, `REPORT_SMTP_USER`, `REPORT_SMTP_PASSWORD` |
| SMS | `REPORT_SMS_PROVIDER`, `REPORT_SMS_API_KEY`, `REPORT_SMS_SENDER`, `REPORT_SMS_TEMPLATE`, `REPORT_SMS_API_URL`, `REPORT_SMS_TIMEOUT_MS`, `REPORT_SMS_MAX_RETRIES` |
| Outbox | `REPORT_OUTBOX_MAX_ATTEMPTS` (default 10), `REPORT_DB_PATH` |

## Owner credential checklist

1. Choose email path: HTTP transactional (`REPORT_EMAIL_API_*`) or SMTP (`REPORT_SMTP_*`).
2. Set `REPORT_EMAIL_FROM` on a domain with SPF, DKIM, and DMARC published.
3. Set `REPORT_SMS_API_KEY` and approved `REPORT_SMS_SENDER`; register OTP templates for `phone_verify` / `phone_recovery`.
4. Configure persistent `REPORT_DB_PATH` on the VPS; verify pending `delivery_outbox` rows drain after provider recovery.
5. Run sandbox send tests manually and record results separately (not automated in CI).

## Commit

_(filled after push)_
