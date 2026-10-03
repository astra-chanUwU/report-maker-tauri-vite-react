# CURSOR_REPORT_C11

C11 on `feat/c11-vps-deploy` from `origin/integrate/control-plane`.

**Delivered:** `docs/deployment.md`, graceful shutdown in `cmd/controlplane`,
SQLite backup/restore scripts (`server/scripts/backup-sqlite.*`,
`verify-sqlite-restore.*`), TODO/README updates.

**Validation:** `go test ./...` and `go vet ./...` pass.

**Unavailable:** live VPS, DNS, HTTPS, passkey browser, ZarinPal, email, SMS,
offsite restore drill (no owner credentials).
