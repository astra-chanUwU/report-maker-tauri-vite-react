# Report Maker — Tauri + React + TypeScript

Tauri 2 + Vite 8 + React 19 + TypeScript + Tailwind 4 + docx 9. Offline spectral report maker — `.sp3` (Jet MDB) or Data-table CSV → editable Word `.docx`.

Source of truth for logic to port: `../report-generator/src/{parseSp3,generateDocx,ai}.js` (offline heuristics).

## Screenshots

> Add PNGs to `docs/screenshots/` and reference here (300–500px wide, light + dark).

- `ingest.png` — drop zone + spectra chart + table (spec-csv, UTF-16LE)
- `chart-edit.png` — draggable chart points, smoothing, point limit
- `export.png` — save dialog / download fallback, history tab

## Quick start

```bash
npm ci            # or npm install (Node 20+, tested Node 26 + npm 11)
npm run dev       # Vite web only → http://localhost:1420
npm run tauri dev # full Tauri (file dialogs, store, mdb-export)
```

Harden lanes: A (bundle/a11y/large-file), B (Tauri bundle + CI/release), C (this polish) are done. Tests: `npm test` (33), Rust: `cargo test --manifest-path src-tauri/Cargo.toml --lib`.

## Toolchain (S00 decision)

- **Package manager: npm** (`package-lock.json` committed). Do not use pnpm/yarn — `pnpm-lock.yaml` is git-ignored.
  `src-tauri/tauri.conf.json` uses `npm run dev` / `npm run build`.
- Node 20+ (tested on Node 26 + npm 11).
- Rust stable for `src-tauri` (optional for frontend-only work).

## Scripts

| Command                        | What it does                                                        |
| ------------------------------ | ------------------------------------------------------------------- |
| `npm run dev`                  | Vite web dev only (browser, no Tauri APIs, `http://localhost:1420`) |
| `npm run tauri dev`            | Full Tauri dev (WebView + Rust, uses `npm run dev` under the hood)  |
| `npm run tauri build`          | Full Tauri production bundle (runs `npm run build` + `cargo`)       |
| `npm run build`                | Typecheck (`tsc -b`) + Vite production build to `dist/`             |
| `npm run preview`              | Preview `dist/` locally                                             |
| `npm run typecheck`            | `tsc --noEmit`                                                      |
| `npm run lint`                 | `prettier --check .`                                                |
| `npm run format`               | `prettier --write .`                                                |
| `node scripts/gen-license.mjs` | Print a valid v1 `RM-XXXX-XXXX-XXXX` key (see `docs/licensing.md`)  |

`npm run dev` vs `npm run tauri` vs `npm run tauri dev`:

- Use `npm run dev` for fast UI iteration (Tauri APIs mocked/absent).
- Use `npm run tauri dev` when you need file-save dialogs, store, opener, etc.
- `npm run tauri` alone is just the Tauri CLI passthrough.

## Importing real data

`.sp3` files are MS Access Jet databases — browsers cannot read them directly.

- **Tauri (recommended):** `Open .sp3 file` → backend runs `mdb-export file.sp3 Data` to a temp CSV (streamed, never full-RAM), then parses first row. Remaining measurements are listed via the measurement picker (rows → on-demand load). No install if `mdb-export` is on `PATH`; override via `MDB_EXPORT_PATH` env or Settings → Tool path.
- **Web / fallback:** export the Data table yourself:

  ```bash
  # macOS (brew) / Ubuntu
  brew install mdbtools        # or: sudo apt-get install mdbtools
  mdb-export file.sp3 Data > data.csv   # 38 columns incl. Specdata (octal blob)
  # then drop data.csv in the web build — header + first row parsed only (<4 MB head),
  # huge files use first-row-only preview; picker streams rows in Tauri.
  ```

Spec CSV shape: 38 columns, `Specdata` = `\ooo` octal of `NoLines` float32-LE amps; `freq(i) = (i+1)*BandWidth`; overall fields (`MeasDate` OLE date → ISO, RMS/Peak, Unit, PointID) travel into preview + docx. Real examples: sample CSV downloadable from the onboarding card.

## Project slices

See [TODO.md](./TODO.md) for remaining control-plane slices (C09–C11 open;
integration branch `integrate/control-plane`). Desktop docx follow-ups live in
[TODO.next.md](./TODO.next.md).

## Releases

- `.github/workflows/release.yml` — on a `v*` tag or manual dispatch, builds Tauri bundles per OS (Tauri Action) and publishes a **draft** GitHub Release.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
