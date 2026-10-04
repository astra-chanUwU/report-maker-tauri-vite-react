# Release artifact publication

Installers live outside SQLite in `REPORT_ARTIFACT_ROOT`. Manifest: `releases.json` or `REPORT_RELEASE_MANIFEST`.

## Publish

```bash
cd server && go run ./cmd/publish-release
```

Targets: `desktop-windows-x64`, `desktop-macos-universal`.

## Security

- SHA-256 computed by publish tool; verified before download.
- Path traversal and symlinks rejected.

## Retention

Current major: while supported. Previous patch: 12 months. Older majors: 6 months after EOL.

## Local dev

`REPORT_ARTIFACT_ROOT=testdata/artifacts REPORT_ALLOW_DEV_SEED=1 go run ./cmd/controlplane`
