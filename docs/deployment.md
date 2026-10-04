# Go service deployment

This document describes the intended first production deployment. It does not
claim that a VPS, DNS, HTTPS certificate, payment account, email provider, SMS
provider, or restore drill has been completed.

## Initial VPS shape

Use an Iran-hosted VPS with roughly 2–4 vCPU, 4 GB RAM, 40–80 GB NVMe, public
IPv4, and outbound HTTPS access to the selected payment, email, and SMS
providers. A single Go process and SQLite writer are the initial deployment
shape.

Choose the final domain before enrolling production passkeys. Example paths:

| Path | Purpose |
| --- | --- |
| `/var/lib/report-maker/report-maker.db` | Persistent SQLite database |
| `/var/lib/report-maker/artifacts` | Published desktop artifacts |
| `/var/backups/report-maker` | Local backup staging |
| `/etc/report-maker/env` | Environment configuration and secrets |
| `/etc/report-maker/keys/` | Restricted signing and delivery keys |

Build the service with:

```bash
cd server
go build -o /usr/local/bin/report-maker ./cmd/controlplane
```

## Production configuration

Production is fail-closed. Set a persistent `REPORT_DB_PATH`, HTTPS
`PUBLIC_BASE_URL`, WebAuthn RP id/origins, Ed25519 signing key, license-delivery
key, ZarinPal merchant id, and real email/SMS provider settings. Development
flags, demo payments, local outbox, fake SMS, and ephemeral keys must not be
used on the host.

The full environment matrix is in [server/README.md](../server/README.md).

## Reverse proxy and process

Terminate TLS at nginx or Caddy and bind the Go process to loopback, for example
`HTTP_ADDR=127.0.0.1:8080`. Forward the original host and HTTPS scheme so
WebAuthn origin checks and Secure cookies see the public request. Allow SSH,
HTTP, and HTTPS through the firewall and keep the application port private.

Run the service under systemd with an `EnvironmentFile`, `SIGTERM` shutdown,
and a stop timeout long enough for the server's 15-second graceful drain.

## Backups

```bash
server/scripts/backup-sqlite.sh [DB_PATH] [BACKUP_DIR]
server/scripts/verify-sqlite-restore.sh BACKUP_FILE
```

Copy backups off the VPS. Back up the Ed25519 signing key and AES license
delivery key separately with restricted access. A backup is not verified until a
clean restore starts the service and passes health checks.

## Required manual checks

These remain unavailable until the owner supplies infrastructure and credentials:

- final domain, DNS, HTTPS, and WebAuthn passkey registration/login;
- ZarinPal request, redirect, callback, amount verification, and retry;
- real email receipt/magic-link delivery and SPF/DKIM/DMARC;
- real SMS phone verification/recovery;
- clean VPS deployment and offsite restore drill;
- signed Tauri artifact publication and customer download.
