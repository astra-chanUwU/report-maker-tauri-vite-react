# C07 — Publish real release artifacts

## Outcome

Reproducible fixture artifacts (Windows + macOS), `go run ./cmd/publish-release`, pre-download checksum verification, install instructions on `/account/downloads`, docs in `docs/releases.md`.

## Publish

```bash
cd server && go run ./cmd/publish-release
```

## Validation

```text
cd server && go test ./... -count=1
cd server && go vet ./...
```

## Git

Branch: `feat/c07-release-artifacts` from `origin/integrate/control-plane`.
