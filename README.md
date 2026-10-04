# Report Maker

Report Maker is an offline-first vibration report maker. The desktop app imports
`.sp3`/Jet MDB data or Data-table CSV files, lets an engineer review and edit the
report, and exports an editable Word document. Customer accounts, payments,
license activation, downloads, and optional hosted services live in a separate
Go web service.

The repository contains two deployables in one monorepo:

```text
src/                 React + TypeScript desktop interface
src-tauri/           Rust/Tauri desktop shell and native file/database access
server/              Go website, control-plane API, payments, auth, and admin
server/cmd/controlplane
                     Go service entry point
```

The desktop report pipeline remains local. `.sp3` files, report content,
filesystem paths, and DOCX generation are not uploaded by the normal workflow.

## Desktop development

Requirements: Node 20+, npm, and Rust stable for Tauri work.

```bash
npm ci
npm run dev          # Vite browser shell at http://localhost:1420
npm run tauri dev   # full desktop application
```

Use `npm run dev` for fast UI work. Use `npm run tauri dev` when testing native
file dialogs, the OS keychain, MDB export, local storage, or DOCX saving.

Useful commands:

```bash
npm run typecheck
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run lint          # Biome lint
npm run format        # Biome formatter
```

`index.html` is the Vite entry shell for this React application. It is not the
customer marketing website.

## Go service development

The Go service renders the public site with `html/template` and HTMX and serves
JSON endpoints under `/v1/*` for the desktop application. It uses SQLite first,
with WAL, foreign keys, a busy timeout, and a single writer connection.

```bash
cd server
REPORT_ENV=development \
REPORT_ALLOW_DEV_SEED=1 \
REPORT_ALLOW_DEMO_PAYMENTS=1 \
go run ./cmd/controlplane
```

The local service listens on `http://localhost:8080` by default. Its public
surface includes:

- marketing and checkout pages: `/`, `/pricing`, `/download`, `/checkout/*`;
- customer sign-in, purchases, and downloads: `/login`, `/account/*`;
- domestic payment redirects and callbacks: `/payments/*`;
- desktop licensing, AI, and telemetry contracts: `/v1/*`;
- separate support administration: `/admin/*`.

Development uses a demo payment gateway, local email outbox, fake SMS, and
ephemeral development keys. Production rejects those substitutes and requires
explicit persistent configuration. See [server/README.md](server/README.md).

## Repository documentation

- [docs/go-architecture.md](docs/go-architecture.md) — deployables, boundaries,
  routes, persistence, and security rules.
- [docs/control-plane.md](docs/control-plane.md) — desktop/server contracts and
  privacy boundaries.
- [docs/licensing.md](docs/licensing.md) — license and signed-lease lifecycle.
- [docs/providers.md](docs/providers.md) — email, SMS, and delivery outbox.
- [docs/releases.md](docs/releases.md) — artifact publication and verification.
- [docs/deployment.md](docs/deployment.md) — planned VPS deployment and manual
  checks that are still unavailable.

## Editor tooling

- `.vscode/extensions.json` only recommends the Biome, Tauri, and Rust Analyzer
  extensions; it does not affect builds or runtime behavior.
- `.editorconfig` gives editors a shared baseline for UTF-8, LF line endings,
  indentation, final newlines, and trailing whitespace.
- `.oxlintrc.json` configures the Rust-based Oxlint linter.
- `.oxfmtrc.json` configures the Rust-based Oxfmt formatter.
- Prettier, ESLint, and Biome are not dependencies.

## Real data import

Browsers cannot read Jet MDB files directly. In the Tauri application, the Rust
side invokes `mdb-export` and streams the Data table to the parser. Install
`mdbtools` separately and override the binary path in Settings or with
`MDB_EXPORT_PATH` when needed:

```bash
brew install mdbtools
mdb-export file.sp3 Data > data.csv
```

The web-only Vite shell accepts CSV fixtures for development; native `.sp3`
access requires Tauri.

## Releases

`.github/workflows/release.yml` is the only GitHub automation remaining. A
`v*` tag or manual dispatch builds draft Tauri bundles for the supported desktop
targets. The Go service is built and deployed separately. Test fixture files in
`server/testdata/artifacts/` are not production installers.

## Current limitations

The codebase has automated unit and contract tests, but production readiness
still requires a real browser passkey test, a ZarinPal sandbox/manual payment
test, configured email/SMS providers, a domain and HTTPS origin, a VPS restore
drill, and signed release artifacts. Those checks are intentionally documented
as unavailable until the required external accounts and infrastructure exist.
