# Release artifacts

Desktop installers are stored outside SQLite under `REPORT_ARTIFACT_ROOT`.
The manifest is `server/releases.json` by default or the path configured by
`REPORT_RELEASE_MANIFEST`.

## Publish locally

```bash
cd server
go run ./cmd/publish-release
```

The current manifest contains Windows x64 and macOS universal entries. The
files under `server/testdata/artifacts/` are tiny test fixtures used to exercise
path and checksum handling; they are not signed customer installers.

## Download safety

- The publisher computes SHA-256 from the exact artifact bytes.
- The download path is resolved under the configured artifact root.
- Traversal and symlink escapes are rejected.
- Entitled customers can download repeatedly; expiring links can be renewed
  after authentication.
- Download audit rows contain artifact and order/license references, never report
  contents.

## Production release checklist

Before publishing a customer release, build and sign real Tauri bundles for the
supported platforms, publish their exact checksums, place them in the artifact
root, and verify a clean authenticated download. Keep test fixtures separate from
the production artifact store.

The release workflow can build draft GitHub Releases from a version tag. It does
not deploy the Go service or replace the manual signing and artifact verification
steps.

## Retention

Keep the current major while supported, previous patches for twelve months, and
older majors for six months after end of life unless the product policy changes.

## Local service

```bash
cd server
REPORT_ENV=development \
REPORT_ARTIFACT_ROOT=testdata/artifacts \
REPORT_ALLOW_DEV_SEED=1 \
REPORT_ALLOW_DEMO_PAYMENTS=1 \
go run ./cmd/controlplane
```
