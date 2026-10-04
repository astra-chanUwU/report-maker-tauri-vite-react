# Email and SMS providers

Provider credentials belong only on the Go service host. The repository contains
interfaces, local fakes, and configuration names; it does not contain provider
secrets.

## Email

| Variable | Purpose |
| --- | --- |
| `REPORT_EMAIL_PROVIDER` | `local`, `http`, `transactional`, `smtp`, `outbox`, or `noop` |
| `REPORT_EMAIL_API_URL` | Transactional HTTP endpoint |
| `REPORT_EMAIL_API_KEY` | Provider token (secret) |
| `REPORT_EMAIL_FROM` | Address on an authenticated sending domain |
| `REPORT_EMAIL_FROM_NAME` | Display name |
| `REPORT_EMAIL_TIMEOUT_MS` | HTTP timeout, default 8000 |
| `REPORT_EMAIL_MAX_RETRIES` | Transient retry count, default 2 |
| `REPORT_SMTP_HOST/PORT` | SMTP fallback |
| `REPORT_SMTP_USER/PASSWORD` | SMTP credentials |

Email covers purchase receipts, license access, magic links, and download
access. Development uses `LocalOutbox`; production must use a configured real
provider.

## SMS

| Variable | Purpose |
| --- | --- |
| `REPORT_SMS_PROVIDER` | `fake`, `kavenegar`, `http`, or `noop` |
| `REPORT_SMS_API_KEY` | Provider token (secret) |
| `REPORT_SMS_SENDER` | Approved sender line |
| `REPORT_SMS_TEMPLATE` | Optional provider template |
| `REPORT_SMS_API_URL` | Custom HTTP endpoint |
| `REPORT_SMS_TIMEOUT_MS` | HTTP timeout, default 8000 |
| `REPORT_SMS_MAX_RETRIES` | Transient retry count, default 2 |

SMS covers phone verification and recovery. Development uses `FakeSMS`;
production must use a real provider.

## Persistent delivery outbox

In environment-configured production mode, every delivery is recorded in the
SQLite `delivery_outbox` table before the provider is called. Pending rows are
retried after restart and periodically during HTTP traffic. Configure
`REPORT_OUTBOX_MAX_ATTEMPTS` and keep `REPORT_DB_PATH` on persistent storage.

Payment and license state are not rolled back when delivery fails. Support can
inspect and retry delivery after the provider recovers.

## Domain authentication

Before production email:

1. publish SPF for the sending domain or mail subdomain;
2. publish the provider's DKIM keys;
3. publish DMARC, beginning with `p=none` while warming up;
4. use `REPORT_EMAIL_FROM` only on the verified domain;
5. verify that magic-link URLs use the production HTTPS origin.

## Provider safety

Adapters use bounded timeouts, limited response bodies, idempotency keys,
redacted errors, and bounded retries. API keys, bearer tokens, license keys,
magic-link tokens, and SMS codes must never appear in logs.

Live provider sends remain unavailable until the owner supplies credentials and a
configured domain/VPS.
