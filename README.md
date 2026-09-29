# Report Maker — Tauri + React + TypeScript

Tauri 2 + Vite 8 + React 19 + TypeScript + Tailwind 4 + docx 9.
Source of truth for logic to port: `../report-generator/src/{parseSp3,generateDocx,ai}.js` (offline heuristics).

## Toolchain (S00 decision)

- **Package manager: npm** (`package-lock.json` committed). Do not use pnpm/yarn.
  `src-tauri/tauri.conf.json` uses `npm run dev` / `npm run build`.
- Node 20+ (tested on Node 26 + npm 11).
- Rust stable for `src-tauri` (optional for frontend-only work).

## Scripts

| Command               | What it does                                                        |
| --------------------- | ------------------------------------------------------------------- |
| `npm run dev`         | Vite web dev only (browser, no Tauri APIs, `http://localhost:1420`) |
| `npm run tauri dev`   | Full Tauri dev (WebView + Rust, uses `npm run dev` under the hood)  |
| `npm run tauri build` | Full Tauri production bundle (runs `npm run build` + `cargo`)       |
| `npm run build`       | Typecheck (`tsc -b`) + Vite production build to `dist/`             |
| `npm run preview`     | Preview `dist/` locally                                             |
| `npm run typecheck`   | `tsc --noEmit`                                                      |
| `npm run lint`        | `prettier --check .`                                                |
| `npm run format`      | `prettier --write .`                                                |

`npm run dev` vs `npm run tauri` vs `npm run tauri dev`:

- Use `npm run dev` for fast UI iteration (Tauri APIs mocked/absent).
- Use `npm run tauri dev` when you need file-save dialogs, store, opener, etc.
- `npm run tauri` alone is just the Tauri CLI passthrough.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Project slices

See [TODO.md](./TODO.md) (S00–S11). One slice = one branch/PR, diffs < 400 lines where possible.
