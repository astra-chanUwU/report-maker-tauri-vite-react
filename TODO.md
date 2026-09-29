# report-maker-tauri-vite-react — TODO

> Tauri 2 + Vite 8 + React 19 + TypeScript + Tailwind 4 + docx 9
> Source of truth for logic to port: `../report-generator/src/{parseSp3,generateDocx,ai}.js`
> Package manager: npm (tauri.conf currently says pnpm — see S00). Node 20+.

## Learned real format (refinement, verified on Elika Tejarat DB)

- `.sp3` = MS Access Jet DB (`Standard Jet DB` magic) — not readable in WebView.
  Drop the raw file and the app explains the export path instead of silent fallback.
- Supported ingest: CSV export of the `Data` table (`mdb-export file.sp3 Data`):
  38 columns, `Specdata` blob = `\ooo` octal escapes of `NoLines` float32-LE amps.
- Freq axis is derived: `freq(i) = (i+1) * BandWidth` (verified: decoded max ==
  `ValuePeakMaxV`, `(argmax+1)*BW` == `FreqPeakMaxV` on 5 real rows).
- `MeasDate` is an OLE Automation date → ISO. Overall RMS/Peak/Unit/Point travel
  in `meta.overall` into preview + docx. Multi-row exports preview row 1 only.
- Future: Tauri-side `mdb-export` integration so raw `.sp3` drops work directly
  (`mdbtools-win` ships the binaries). 76–960 MB files + 296 MB CSVs exist —
  never full-decode for sniffing; first-row-only parse is intentional.

Each slice is self-contained for one agent. Check the box when done. Respect `Depends on`.

---

### S00 — Chore: align toolchain

**Depends on:** none
**Goal:** deterministic dev/build for every agent.

- Decide `npm` vs `pnpm` (repo currently installed with `npm 10`; `src-tauri/tauri.conf.json` says `pnpm dev/build`). Pick one and fix `tauri.conf.json` + README.
- Add scripts: `lint`, `format`, `typecheck` (tsc --noEmit). Add `.editorconfig` if missing.
- Ensure `npm run build` and `cargo check` (if Rust toolchain present) both green.
- Document `npm run dev` vs `npm run tauri` vs `npm run tauri dev`.

**Done when:** `tauri.conf.json` matches chosen PM, README updated, `npm run build` passes.

---

### S01 — Design system: Tailwind + shadcn

**Depends on:** S00
**Goal:** app doesn't look like Vite template.

- Init `shadcn/ui` (works with Vite + Tailwind 4): `npx shadcn@latest init`, pick style/new-york, neutral base, CSS variables.
- Add primitives needed early: `Button`, `Input`, `Label`, `Card`, `Table`, `Dialog`, `Tabs`, `Toast`/`Sonner`.
- Replace `src/App.css` with Tailwind tokens + `src/index.css` via shadcn. Keep `App.tsx` minimal (shell only).
- Verify dark mode + focus rings.

**Done when:** `npx tsc --noEmit` passes, story/demo page renders shadcn components, no template CSS remains.

---

### S02 — Core engine (no UI): parseSp3 + generateDocx + ai fallback

**Depends on:** S00
**Goal:** port offline logic to `src/lib/` as pure TS, fully tested, no Tauri APIs.

- `src/lib/parseSp3.ts` — port `../report-generator/src/parseSp3.js`:
  - Input: `Uint8Array | ArrayBuffer`, filename. Output: `{ meta, spectra: {freq,amp}[] }`
  - Preserve heuristics: text CSV → binary float32 LE pairs → synthetic demo fallback (keep same behavior for now).
  - Export stats: `spectra_points`, `freq_min/max`, `amp_min/max`, `peak`.
- `src/lib/generateDocx.ts` — port `generateDocx.js` to `docx@9` API:
  - `buildDocx({ meta, spectra, options, aiDraft }) => Promise<Buffer|Blob>` using `Packer.toBlob` for browser.
  - Keep editable tables + PNG chart via `renderChartPng`/`encodePng` (fix duplicated IDAT logic; use `zlib` only if available, else pure-JS fallback).
  - No `fs`, no `Buffer` Node-only — use `Uint8Array` so it runs in WebView.
- `src/lib/ai.ts` — port `ai.js`:
  - Client-side `draftReport({meta,spectra,options})` with `OPENAI_API_KEY` optional; fallbackDraft when offline.
  - Don't ship key; read from settings store (S08) or env for dev.
- Add unit tests: `src/lib/__tests__/parseSp3.test.ts` + `generateDocx.test.ts` (vitest). Include 3 fixtures: text .sp3, binary float32 .sp3, empty → synthetic.

**Done when:** tests green, `buildDocx` produces valid `.docx` (unzip check), no Node `require('zlib')` crash in WebView.

---

### S03 — Ingest UI: drop zone + preview

**Depends on:** S01, S02
**Goal:** user can drop a `.sp3` and see data.

- File drop + file picker (accept `.sp3`, `.txt`, `.csv` for dev). Use HTML5 File API; no Tauri fs yet.
- Call `parseSp3`, show: filename, size, points, range, peak, warning if synthetic fallback.
- Preview: spectra table (first 80 rows, virtualize if >500) + chart preview (canvas or SVG line chart — live, not just docx PNG).
- Error/empty states.

**Done when:** dropping `report-generator` fixtures shows correct meta + table + chart, synthetic case shows banner.

---

### S04 — Report form: metadata & defaults

**Depends on:** S01
**Goal:** predictable defaults, no blank report.

- Fields: `projectName`, `engineer`, `reportDate` (default today), `units` (SI/metric toggle), `norm` (Default/normalization string), `notes` (textarea).
- Validation (zod or simple): required: projectName, engineer. Date = ISO yyyy-mm-dd.
- Persist defaults to Tauri store (see S08, but make this slice work with `localStorage` fallback so it doesn't block).
- `Reset to defaults` + `Clear`.

**Done when:** form values feed `options` for S05/S06, persists across reload.

---

### S05 — Export: .docx generation + save

**Depends on:** S02, S03, S04
**Goal:** one click → editable Word file on disk.

- Wire `Generate Report` button: `buildDocx({meta,spectra,options,aiDraft})` → save.
- Tauri path: use `@tauri-apps/plugin-dialog` `save()` + `@tauri-apps/plugin-fs` (or `writeFile` via Rust) to write Blob. Web fallback: anchor download.
- Filename: `${projectName}-${date}.docx` sanitized.
- Toast on success + `Open folder` (via `plugin-opener`).
- Handle large spectra (80–500 rows) without OOM.

**Done when:** dropped file + form → generates and saves `.docx` that opens in Word/LibreOffice with editable tables + chart image.

---

### S06 — Live chart editing

**Depends on:** S03, S05
**Goal:** edit before export, not after.

- Chart component with editable data points (drag or table inline edit) — updates preview + `spectra` array.
- Controls: smoothing, peak highlight toggle, point limit (80/120/400).
- Edits are in-memory only; export uses edited `spectra`.

**Done when:** editing a point/table cell updates chart + exported docx table + PNG.

---

### S07 — Templates & branding

**Depends on:** S01, S05
**Goal:** template gallery + custom cover/logo.

- Gallery: 2–3 docx templates (cover layout, color, fonts) selectable before export. Store choice in settings.
- Branding: upload logo (png/svg) + cover image, preview on cover. Persist via store.
- `generateDocx` accepts `templateId` + `branding` (logo as base64 ImageRun).

**Done when:** switching template changes docx cover/headings/colors; logo appears on cover and header.

---

### S08 — History & persistence (past reports)

**Depends on:** S01, S02
**Goal:** past reports list, no server.

- Choose Tauri store: `tauri-plugin-store` or `tauri-plugin-sql` (SQLite). Keep `localStorage` adapter for `vite dev`.
- Store: report history entries `{ id, projectName, engineer, date, filename, meta, options }` (not full spectra Blob beyond threshold — store file path or truncated).
- UI: `Past Reports` tab — list, search, reopen, delete, `Reveal in Finder`.
- Cap history at 100 entries.

**Done when:** generating a report adds to history; reload restores list; delete works.

---

### S09 — Licensing & updates

**Depends on:** S05
**Goal:** perpetual key + optional subscription check, Tauri-native.

- Decide model: perpetual license key (offline-validated) + optional subscription for updates/AI. Document decision in `docs/licensing.md`.
- Implement key validation in Rust (`src-tauri/src/license.rs`): HMAC or JWT, stored via `tauri-plugin-store`. Offline grace period.
- UI: `Settings → License` — enter key, status, `Check for updates` (via `tauri-plugin-updater` or manual GitHub Releases).
- No hard lock on dev builds.

**Done when:** license enter/validate persists; app runs without license in dev; updater check works.

---

### S10 — Telemetry & crashes (PostHog)

**Depends on:** S01, S08
**Goal:** opt-in analytics, no surprise tracking.

- Add PostHog JS (`posthog-js`) or Tauri-compatible proxy. Disabled by default.
- Settings toggle: `Share anonymous usage & crash reports` (default OFF). When off, zero network calls.
- Events: `report_generated`, `report_failed`, `app_started`, `license_validated` — no PII, no spectra contents.
- Crash: hook `window.onerror` + Rust panic via `tauri` logging to PostHog.

**Done when:** toggle off = no requests (verified in devtools); toggle on = events flow to PostHog (or console mock).

---

### S11 — AI drafts (online, optional)

**Depends on:** S02, S04
**Goal:** `AI Assist` is additive, never required.

- Settings: `OpenAI API key` + `Model` (default `gpt-4o-mini`), stored locally, never committed.
- UI: `Draft with AI` button on report form — calls `draftReport`, fills `Summary/Methodology/Observations/Recommendations/Conclusion` fields (editable).
- Offline/failed → fallbackDraft + toast, never block export.
- Rate-limit / 30s timeout.

**Done when:** with key → AI fills fields; without key/offline → fallback fills fields; user can edit before export.

---

## Agent rules

- One slice = one branch/PR. Keep diffs < 400 lines where possible.
- Run `npm run build` before pushing. Don't `cargo` break `src-tauri`.
- Don't invent `.sp3` format — keep heuristics, add fixtures instead of guessing.
- Ask in PR description: "Slice S0X — ..." and check the box here when merged.

## Suggested order for parallel work

- Wave 1 (no deps): S00
- Wave 2: S01, S02
- Wave 3: S03, S04, S08-start, S11-start
- Wave 4: S05, S06, S07, S09, S10
