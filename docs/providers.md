# Email and SMS providers (C08)

Production delivery is configured entirely through environment variables on the
host. No provider credentials belong in the repository.

## Email

| Variable | Purpose |
| --- | --- |
| `REPORT_EMAIL_PROVIDER` | `local` (default), `kavenegar` / `http` (transactional HTTP), `smtp`, `outbox` (persist-only, no external send), or `noop` |
| `REPORT_EMAIL_API_URL` | Transactional HTTP endpoint (Iranian provider or compatible) |
| `REPORT_EMAIL_API_KEY` | Provider API token (**secret**) |
| `REPORT_EMAIL_FROM` | From address on an authenticated sending domain |
| `REPORT_EMAIL_FROM_NAME` | Display name (default `Report Maker`) |
| `REPORT_EMAIL_TIMEOUT_MS` | HTTP timeout (default `8000`) |
| `REPORT_EMAIL_MAX_RETRIES` | Retries on transient HTTP failures (default `2`) |
| `REPORT_SMTP_HOST` | SMTP relay hostname |
| `REPORT_SMTP_PORT` | SMTP port (default `587`; use `465` for implicit TLS) |
| `REPORT_SMTP_USER` | SMTP username (**secret**) |
| `REPORT_SMTP_PASSWORD` | SMTP password (**secret**) |

`REPORT_EMAIL_PROVIDER=smtp` uses a generic SMTP relay as fallback when no
HTTP transactional API is available.

## SMS (OTP)

| Variable | Purpose |
| --- | --- |
| `REPORT_SMS_PROVIDER` | `fake` (default), `kavenegar`, `http`, or `noop` |
| `REPORT_SMS_API_KEY` | Kavenegar or HTTP API token (**secret**) |
| `REPORT_SMS_SENDER` | Approved sender line / short code |
| `REPORT_SMS_TEMPLATE` | Optional provider template name for OTP messages |
| `REPORT_SMS_API_URL` | Custom HTTP endpoint when not using built-in Kavenegar URL |
| `REPORT_SMS_TIMEOUT_MS` | HTTP timeout (default `8000`) |
| `REPORT_SMS_MAX_RETRIES` | Retries on transient HTTP failures (default `2`) |

Phone verification SMS uses kinds `phone_verify` and `phone_recovery`. Message
bodies are composed server-side; register matching templates with the provider
before production.

## Persistent outbox

When the app is started from environment configuration (production), every email
and SMS send is recorded in SQLite table `delivery_outbox` before the provider
is called. Pending rows are retried on startup and at most once every ten
seconds during HTTP traffic.

| Variable | Purpose |
| --- | --- |
| `REPORT_OUTBOX_MAX_ATTEMPTS` | Mark a row `failed` after this many attempts (default `10`) |
| `REPORT_DB_PATH` | SQLite file that must persist across restarts |

Unit tests inject `LocalOutbox` / `FakeSMS` directly and skip the persistent
wrap so fakes remain in-process.

## Domain authentication (email)

Before sending production mail:

1. Publish **SPF** for the sending domain (or subdomain such as `mail.example.ir`).
2. Add the provider's **DKIM** keys and verify them in the provider console.
3. Publish **DMARC** (`p=none` while warming up; tighten to `quarantine` / `reject` later).
4. Set `REPORT_EMAIL_FROM` only on the verified domain.
5. Confirm magic-link URLs use the production `PUBLIC_BASE_URL` HTTPS origin.

## Timeouts and retries

- Provider HTTP clients default to **8 s** timeouts (`REPORT_*_TIMEOUT_MS`).
- Transient HTTP failures (5xx, 429, transport errors) retry up to
  `REPORT_*_MAX_RETRIES` (default **2**) with linear backoff inside the adapter.
- The SQLite outbox retries independently until `REPORT_OUTBOX_MAX_ATTEMPTS`.
- Payment and license state are never rolled back when delivery fails; support
  can re-drive pending rows after recovery.

## Logging

Adapters redact API keys, bearer tokens, license keys, and long opaque strings
from logs and stored `last_error` values. Never enable debug logging that prints
raw provider responses in production.

## Live provider checks

Sandbox and manual sends against real Iranian providers require owner-supplied
credentials. Record those checks separately from automated tests; they are
**unavailable** until DNS and API keys are configured on the VPS.
