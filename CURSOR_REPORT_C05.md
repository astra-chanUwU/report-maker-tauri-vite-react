# CURSOR_REPORT_C05 — Add Go checks to GitHub Actions

**Model:** Composer 2.5 High (orchestrator unavailable — Composer used for implementation).

## Slice and outcome

Added a separate **`go`** job to `.github/workflows/ci.yml` so control-plane checks run independently of the desktop frontend/Rust pipeline. Renamed the existing job to **`frontend-rust`** for clarity.

**Done:** Go 1.26 (from `server/go.mod`), module cache, `go mod download`, `go test ./...`, and `go vet ./...` on `ubuntu-latest`.

**Intentionally skipped:** `-race` — SQLite uses a single writer; race detector is flaky and not required for this slice.

**Note:** `pull_request` already runs CI for PRs targeting any branch (including `integrate/control-plane`). Push triggers remain `main` / `master` only.

## Files changed

| Area | Files |
|------|-------|
| CI | `.github/workflows/ci.yml` — split `check` → `frontend-rust` + `go` |
| Docs | `TODO.md` (C05 status), `CURSOR_REPORT_C05.md` |

## Architecture decisions

1. **Separate jobs, not a matrix:** frontend/Rust and Go have different toolchains and caches; independent jobs make pass/fail visible in the GitHub UI.
2. **`go-version-file`:** reads `go 1.26.0` from `server/go.mod` so CI tracks the module declaration.
3. **`cache-dependency-path: server/go.sum`:** scopes module cache to the control-plane module.
4. **No `-race`:** documented in workflow comment; migration-upgrade and C04 e2e tests run under plain `go test ./...`.

## Validation evidence

Local (Windows, Go 1.27.0, clean `origin/integrate/control-plane` @ `5772302`):

```text
cd server
set GOPROXY=https://goproxy.io,https://goproxy.cn,direct
set GOSUMDB=off
go test ./... -count=1   # PASS (~16s)
go vet ./...             # PASS
```

Tests included in `go test ./...`:

- `store_migration_test.go` — legacy schema upgrade (C01)
- `c04_e2e_flow_test.go` — checkout → verify → license → email → download (C04)
- disclosure, payment, checkout, download, and provider tests

YAML: structure reviewed manually (PyYAML unavailable locally).

GitHub Actions: push to `feat/c05-go-ci` triggers workflow via `pull_request` when opening a PR; confirm green run on GitHub after push.

## Known limitations

- Go CI not yet verified on GitHub Actions runner (awaiting push).
- Push CI still limited to `main`/`master`; integration-branch pushes do not trigger `push` events (PRs do).
- Local Go 1.27.0 vs CI Go 1.26.0 from `go.mod` — compatible for this module.

## Next slice

**C06 — Make production configuration fail closed** (depends on C04): reject demo gateway, LocalOutbox, and FakeSMS in production; require signing/delivery keys and provider config at startup.

## Git state

- **Branch:** `feat/c05-go-ci` (from `origin/integrate/control-plane` @ `5772302`)
- **Commit:** see push output below
- **Stash:** prior C07 WIP saved as `c07-wip-before-c05` on `feat/c07-release-artifacts`
