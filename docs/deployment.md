# VPS deployment (C11)

Production deployment for the Report Maker control plane on an Iran-hosted VPS.
**No live VPS credentials or DNS in this repo** — external checks **unavailable**
until the owner supplies them.

## VPS profile

2–4 vCPU, 4 GB RAM, 40–80 GB NVMe, public IPv4, outbound HTTPS (ZarinPal, email,
SMS). Ubuntu 22.04 or Debian 12. Single Go process + SQLite writer.

## Domain, service user, paths

Choose final domain before passkey enrollment. User `reportmaker`:

| Path | Purpose |
| --- | --- |
| `/var/lib/report-maker/report-maker.db` | `REPORT_DB_PATH` |
| `/var/lib/report-maker/artifacts` | `REPORT_ARTIFACT_ROOT` |
| `/var/backups/report-maker` | local backups (copy offsite) |
| `/etc/report-maker/env` | secrets (640) |
| `/etc/report-maker/keys/` | signing + delivery keys (600) |

Build: `cd server && go build -o /usr/local/bin/report-maker ./cmd/controlplane`

## Environment

Production fail-closed — see [`server/README.md`](../server/README.md). Set
`PUBLIC_BASE_URL=https://example.ir`, `HTTP_ADDR=127.0.0.1:8080`,
`REPORT_WEB_AUTHN_RP_ID`, `REPORT_WEB_AUTHN_ORIGINS`, provider vars.

## Signing and delivery keys (separate protection)

| Key | Env | Role |
| --- | --- | --- |
| Ed25519 | `REPORT_SIGNING_PRIVATE_KEY` | Lease signatures |
| AES | `REPORT_LICENSE_DELIVERY_KEY` | License delivery encryption |

Store under `/etc/report-maker/keys/` (600). Back up **separately** from SQLite.

## HTTPS, firewall, systemd

TLS at nginx/Caddy; app on loopback. ufw: SSH, 80, 443. systemd:
`KillSignal=SIGTERM`, `TimeoutStopSec=20`, `EnvironmentFile=/etc/report-maker/env`.

## Health, readiness, graceful shutdown

`GET /healthz`, `GET /readyz`. `cmd/controlplane` drains HTTP (15 s) on SIGTERM
then `App.Close()`.

## SQLite backup / restore verification

```bash
server/scripts/backup-sqlite.sh [DB_PATH] [BACKUP_DIR]
server/scripts/verify-sqlite-restore.sh BACKUP_FILE
```

Windows: `backup-sqlite.ps1`, `verify-sqlite-restore.ps1`.

## WebAuthn checklist

- [ ] Final domain + DNS before enrollment
- [ ] Canonical HTTPS `PUBLIC_BASE_URL`
- [ ] RP ID = registrable domain; origins complete
- [ ] Proxy forwards Host / X-Forwarded-Proto
- [ ] Manual passkey test (**unavailable** here)

## Live provider checks

| Check | Status |
| --- | --- |
| ZarinPal | **Unavailable** |
| Email SPF/DKIM/DMARC | **Unavailable** |
| SMS OTP | **Unavailable** |
| VPS HTTPS + passkey | **Unavailable** |
| Offsite restore drill | **Unavailable** (scripts only) |

See [`releases.md`](releases.md), [`providers.md`](providers.md).
